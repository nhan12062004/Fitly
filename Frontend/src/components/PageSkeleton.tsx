import type { ReactNode } from 'react';

export function SkeletonBlock(className: string) {
  return <div className={`rounded-full bg-bg-tertiary/70 ${className}`} />;
}

export function SkeletonSurface({
  children,
  className = ''
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border-primary bg-bg-secondary/60 shadow-[0_22px_60px_rgba(0,0,0,0.1)] ${className}`.trim()}
    >
      {children}
    </section>
  );
}

export function SkeletonHero({
  titleWidth = 'w-[72%] max-w-[22rem]',
  chips = 3,
  className = ''
}: {
  titleWidth?: string;
  chips?: number;
  className?: string;
}) {
  return (
    <SkeletonSurface className={`overflow-hidden px-5 py-5 shadow-[0_18px_48px_rgba(0,0,0,0.12)] md:px-6 md:py-5 ${className}`.trim()}>
      <div className="min-w-0">
        {SkeletonBlock('h-4 w-28')}
        {SkeletonBlock(`mt-3 h-7 rounded-2xl ${titleWidth}`)}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: chips }).map((_, index) => (
          <div
            key={index}
            className="h-10 w-[11rem] rounded-full border border-border-primary bg-bg-tertiary/40 md:w-[12.5rem]"
          />
        ))}
      </div>
    </SkeletonSurface>
  );
}
