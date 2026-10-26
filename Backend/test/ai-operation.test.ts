import { beforeEach, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
const { rpc } = vi.hoisted(() => ({ rpc:vi.fn() }));
vi.mock('../src/config/Supabase',() => ({ adminSupabase:{rpc} }));
import { aiOperationContext, createAiOperationWrapper } from '../src/services/ai/aiOperationService';

beforeEach(() => { rpc.mockReset(); vi.stubEnv('AI_ENABLED','true'); });
const access = async () => ({ quotaWindow:{startsAt:'2026-10-01',endsAt:null},quotas:{limits:{chatMessages:1,planGenerations:1,workoutAdjustments:1,mealAdjustments:1}} });
function fixture() {
  const req = {auth:{user:{id:'user-a'}},path:'/api/ai/chat',body:{message:'Hello'},requestId:'request',get:()=> 'request-key'} as unknown as Request;
  const res = {setHeader:vi.fn(),status:vi.fn(),json:vi.fn()} as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);
  const next = vi.fn() as NextFunction;
  return {req,res,next};
}
it('reserves before the handler and persists its response before sending it', async () => {
  rpc.mockResolvedValueOnce({data:{kind:'started',id:'operation'},error:null}).mockImplementationOnce(async () => {
    expect(res.json).not.toHaveBeenCalled(); return {error:null};
  });
  const {req,res,next} = fixture();
  const handler = vi.fn(async (_req,res) => {
    expect(aiOperationContext.getStore()?.id).toBe('operation');
    res.json({reply:'ok'});
  });
  await createAiOperationWrapper(access)(handler,'chatMessages')(req,res,next);
  expect(rpc.mock.calls[1][1]).toMatchObject({p_id:'operation',p_charge:true,p_status:200});
  expect(res.json).toHaveBeenCalledWith({reply:'ok'});
});
it('replays a completed request without calling the provider handler', async () => {
  rpc.mockResolvedValueOnce({data:{kind:'replay',status:200,body:{reply:'cached'}},error:null});
  const {req,res,next} = fixture(); const handler = vi.fn();
  await createAiOperationWrapper(access)(handler,'chatMessages')(req,res,next);
  expect(handler).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({reply:'cached'});
});
it('does not charge again when a handler finds the already-persisted result', async () => {
  rpc.mockResolvedValueOnce({data:{kind:'started',id:'operation'},error:null}).mockResolvedValueOnce({error:null});
  const {req,res,next} = fixture();
  await createAiOperationWrapper(access)(async (_req,res) => { res.json({alreadyApplied:true}); },'chatMessages')(req,res,next);
  expect(rpc.mock.calls[1][1].p_charge).toBe(false);
});
it('fails closed on a database admission error', async () => {
  rpc.mockResolvedValueOnce({error:{code:'unavailable'}});
  const {req,res,next} = fixture(); const handler = vi.fn();
  await createAiOperationWrapper(access)(handler,'chatMessages')(req,res,next);
  expect(handler).not.toHaveBeenCalled(); expect(next).toHaveBeenCalled();
});

it('refunds a known failure before any business mutation', async () => {
  rpc.mockResolvedValueOnce({data:{kind:'started',id:'operation'},error:null}).mockResolvedValueOnce({error:null});
  const {req,res,next} = fixture();
  await createAiOperationWrapper(access)(async (_req,res) => { res.status(503).json({error:'Provider unavailable'}); },'chatMessages')(req,res,next);
  expect(rpc.mock.calls[1][1].p_charge).toBe(false);
});

it('retains a reservation on an uncertain failure after a business write', async () => {
  rpc.mockResolvedValueOnce({data:{kind:'started',id:'operation'},error:null}).mockResolvedValueOnce({error:null});
  const {req,res,next} = fixture();
  await createAiOperationWrapper(access)(async (_req,res) => {
    aiOperationContext.getStore()!.mutationMayHaveCommitted = true;
    res.status(502).json({error:'Unknown outcome'});
  },'chatMessages')(req,res,next);
  expect(rpc.mock.calls[1][1].p_charge).toBe(true);
});
