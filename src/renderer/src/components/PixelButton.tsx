import { CSSProperties, ReactNode, useState } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: CSSProperties;
  title?: string;
}

const heightBySize: Record<Size, number> = { sm: 28, md: 36, lg: 44 };
const padBySize: Record<Size, string> = { sm: '0 12px', md: '0 16px', lg: '0 20px' };

export function PixelButton({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
  fullWidth = false,
  style,
  title
}: ButtonProps) {
  const [hover, setHover] = useState(false);

  const disabledText = 'var(--cth-ink-500)';

  const palette = (() => {
    switch (variant) {
      case 'primary':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? 'var(--cth-ink-700)' : 'var(--cth-ink-900)'),
          text:    disabled ? disabledText : 'var(--cth-cream-50)',
          border:  'transparent',
          shadow:  'rgba(0,0,0,0.1)'
        };
      case 'secondary':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? 'var(--cth-cream-200)' : 'var(--cth-cream-100)'),
          text:    disabled ? disabledText : 'var(--cth-ink-900)',
          border:  'var(--cth-ink-300)',
          shadow:  'rgba(0,0,0,0.05)'
        };
      case 'ghost':
        return {
          fill:    hover ? 'var(--cth-cream-200)' : 'transparent',
          text:    disabled ? disabledText : 'var(--cth-ink-700)',
          border:  'var(--cth-ink-300)',
          shadow:  'transparent'
        };
      case 'destructive':
        return {
          fill:    disabled ? 'var(--cth-cream-300)' : (hover ? 'var(--cth-coral-light)' : 'var(--cth-coral)'),
          text:    disabled ? disabledText : 'var(--cth-ink-900)',
          border:  'transparent',
          shadow:  'rgba(0,0,0,0.1)'
        };
    }
  })();

  return (
    <button
      title={title}
      onClick={disabled ? undefined : onClick}
      onMouseLeave={() => { setHover(false); }}
      onMouseEnter={() => setHover(true)}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        lineHeight: 1,
        flexShrink: 0,
        height: heightBySize[size],
        padding: padBySize[size],
        background: palette.fill,
        color: palette.text,
        border: variant === 'ghost' || variant === 'secondary' ? `1px solid ${palette.border}` : 'none',
        borderRadius: 'var(--cth-radius, 6px)',
        boxShadow: disabled ? 'none' : `0 1px 2px ${palette.shadow}`,
        transition: 'all 0.15s ease',
        fontFamily: 'var(--cth-font-ui)',
        fontWeight: 500,
        fontSize: size === 'lg' ? 'var(--cth-text-body-md)' : 'var(--cth-text-body-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: fullWidth ? '100%' : 'auto',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {children}
    </button>
  );
}
