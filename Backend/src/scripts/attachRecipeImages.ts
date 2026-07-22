import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { supabase } from '../config/Supabase.js';

type ProcessResult = {
  id: string;
  name: string;
  success: boolean;
  imageUrl?: string;
  error?: string;
};

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchImageCandidates(query: string): Promise<string[]> {
  try {
    const pageRes = await axios.get('https://duckduckgo.com/', {
      params: { q: query },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 7000,
    });
    const match = pageRes.data.match(/vqd=([\d-]+)/) || pageRes.data.match(/vqd=\"([\d-]+)\"/);
    if (!match) return [];
    const vqd = match[1];

    const imgRes = await axios.get('https://duckduckgo.com/i.js', {
      params: { q: query, o: 'json', vqd },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 7000,
    });

    const results = imgRes.data?.results || [];
    const candidates: string[] = [];
    for (const item of results) {
      if (item.image && typeof item.image === 'string' && item.image.startsWith('http')) {
        candidates.push(item.image);
      }
    }
    return candidates;
  } catch {
    return [];
  }
}

async function downloadValidImage(candidates: string[]): Promise<{ buffer: Buffer; contentType: string; ext: string } | null> {
  for (const url of candidates) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 8000,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });
      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('image') && !contentType.includes('octet-stream')) {
        continue;
      }
      const buffer = Buffer.from(res.data);
      if (buffer.length < 5000) {
        continue;
      }

      let ext = 'jpg';
      if (contentType.includes('png') || url.toLowerCase().includes('.png')) ext = 'png';
      else if (contentType.includes('webp') || url.toLowerCase().includes('.webp')) ext = 'webp';

      const finalContentType = contentType.includes('image/') ? contentType : `image/${ext}`;
      return { buffer, contentType: finalContentType, ext };
    } catch {
      // Try next candidate
    }
  }
  return null;
}

async function main() {
  const excelPath = path.resolve(process.cwd(), '../Fitly_200_Recipes_Northern_Vietnam.xlsx');
  console.log(`Reading Excel file from: ${excelPath}`);

  const wb = XLSX.readFile(excelPath);
  const sheet200Name = wb.SheetNames.includes('200 Recipes') ? '200 Recipes' : wb.SheetNames[0];
  const sheetTechName = wb.SheetNames.includes('Technical Data') ? 'Technical Data' : null;

  const rows200: Record<string, any>[] = XLSX.utils.sheet_to_json(wb.Sheets[sheet200Name], { defval: '' });
  const rowsTech: Record<string, any>[] = sheetTechName ? XLSX.utils.sheet_to_json(wb.Sheets[sheetTechName], { defval: '' }) : [];

  console.log(`Found ${rows200.length} rows in "${sheet200Name}".`);

  // Ensure storage bucket exists
  const { error: bucketErr } = await supabase.storage.getBucket('recipes');
  if (bucketErr) {
    console.log('Bucket "recipes" does not exist. Creating public bucket...');
    const { error: createErr } = await supabase.storage.createBucket('recipes', { public: true });
    if (createErr) {
      throw new Error(`Failed to create Supabase storage bucket "recipes": ${createErr.message}`);
    }
  }

  const results: ProcessResult[] = [];
  let successCount = 0;

  for (let i = 0; i < rows200.length; i++) {
    const row = rows200[i];
    const recipeId = String(row.ID || row.id || '').trim();
    const recipeName = String(row['Tên món'] || row.name || '').trim();

    if (!recipeId || !recipeName) {
      console.log(`[${i + 1}/${rows200.length}] Skipping invalid row without ID/name`);
      continue;
    }

    console.log(`[${i + 1}/${rows200.length}] Processing: ${recipeId} ("${recipeName}")...`);

    // Search query
    const searchQuery = `${recipeName} món ăn Việt Nam`;
    let candidates = await fetchImageCandidates(searchQuery);

    if (candidates.length === 0) {
      // Fallback query
      const fallbackQuery = `${recipeName} ẩm thực`;
      candidates = await fetchImageCandidates(fallbackQuery);
    }

    const downloaded = await downloadValidImage(candidates);

    if (!downloaded) {
      console.error(`  ❌ Failed to download valid image for ${recipeId}`);
      results.push({ id: recipeId, name: recipeName, success: false, error: 'No valid image found/downloaded' });
      await sleep(300);
      continue;
    }

    const fileName = `${recipeId}.${downloaded.ext}`;
    const storagePath = fileName;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('recipes')
      .upload(storagePath, downloaded.buffer, {
        contentType: downloaded.contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`  ❌ Supabase upload failed for ${recipeId}: ${uploadError.message}`);
      results.push({ id: recipeId, name: recipeName, success: false, error: uploadError.message });
      await sleep(300);
      continue;
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage.from('recipes').getPublicUrl(storagePath);
    const publicUrl = publicUrlData.publicUrl;

    // Update Supabase DB
    const { error: dbError } = await supabase
      .from('recipes')
      .update({ image_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', recipeId);

    if (dbError) {
      console.warn(`  ⚠️ Warning: DB update failed for ${recipeId}: ${dbError.message}`);
    }

    // Update Excel row fields
    row['Image path'] = publicUrl;
    if (row.image_url !== undefined) row.image_url = publicUrl;

    if (rowsTech.length > 0) {
      const techRow = rowsTech.find((r) => String(r.id || r.ID || '').trim() === recipeId);
      if (techRow) {
        techRow.image_url = publicUrl;
        if (techRow['Image path'] !== undefined) techRow['Image path'] = publicUrl;
      }
    }

    successCount++;
    console.log(`  ✅ Successfully uploaded & linked: ${publicUrl}`);
    results.push({ id: recipeId, name: recipeName, success: true, imageUrl: publicUrl });

    await sleep(400); // polite delay
  }

  // Update Excel file
  wb.Sheets[sheet200Name] = XLSX.utils.json_to_sheet(rows200);
  if (sheetTechName && rowsTech.length > 0) {
    wb.Sheets[sheetTechName] = XLSX.utils.json_to_sheet(rowsTech);
  }
  XLSX.writeFile(wb, excelPath);
  console.log(`Updated Excel file saved at: ${excelPath}`);

  // Save report
  const reportPath = path.resolve(process.cwd(), 'reports/recipe-images-attachment-report.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ total: rows200.length, successCount, results }, null, 2), 'utf8');
  console.log(`Report written to: ${reportPath}`);

  console.log(`\n=== SUMMARY ===\nTotal recipes: ${rows200.length}\nSuccessfully processed: ${successCount}\nFailed: ${rows200.length - successCount}\n`);
}

main().catch((err: unknown) => {
  console.error('Fatal error running script:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

