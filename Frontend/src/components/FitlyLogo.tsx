import './FitlyLogo.css';

export default function FitlyLogo({
  size = 'regular',
  className = '',
}: {
  size?: 'compact' | 'regular';
  className?: string;
}) {
  return (
    <span className={`fitly-logo fitly-logo-${size} ${className}`} role="img" aria-label="Fitly">
      <span aria-hidden="true">Fitly<span className="fitly-logo-dot">.</span></span>
    </span>
  );
}
