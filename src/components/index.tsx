import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

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
