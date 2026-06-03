import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

// ── QtyStepper ────────────────────────────────────────────────────────────────

interface QtyStepperProps {
  value: number
  max: number
  disabled?: boolean
  onChange: (value: number) => void
}

export function QtyStepper({ value, max, disabled = false, onChange }: QtyStepperProps) {
  return (
    <div className="qty-stepper">
      <button
        aria-label="تقليل الكمية"
        className="qty-btn"
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
        type="button"
      >
        −
      </button>
      <input
        aria-label="الكمية"
        disabled={disabled}
        max={max}
        min={1}
        onChange={(e) => {
          const v = Math.max(1, Math.min(max, Number(e.target.value) || 1))
          onChange(v)
        }}
        type="number"
        value={value}
      />
      <button
        aria-label="زيادة الكمية"
        className="qty-btn"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        type="button"
      >
        +
      </button>
    </div>
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function Button({ className = '', variant = 'primary', ...props }: ButtonProps) {
  return <button className={`button button-${variant} ${className}`.trim()} {...props} />
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function Field({ label, id, className = '', ...props }: FieldProps) {
  const inputId = id ?? props.name

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      <span>{label}</span>
      <input id={inputId} {...props} />
    </label>
  )
}

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return <section className={`card ${className}`.trim()}>{children}</section>
}
