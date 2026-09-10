import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({
  children,
  className = "",
  ...props
}: CardProps) {
  return (
    <div className={`ui-card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = "",
  ...props
}: CardProps) {
  return (
    <div className={`ui-card-header ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardContent({
  children,
  className = "",
  ...props
}: CardProps) {
  return (
    <div className={`ui-card-content ${className}`} {...props}>
      {children}
    </div>
  );
}
