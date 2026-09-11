import Link from "next/link";

import { Badge } from "@/components/ui/badge";

type MasterDataListItem = {
  id: string;
  href: string;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  meta?: string | null;
};

type MasterDataListProps = {
  items: MasterDataListItem[];
  selectedId?: string | null;
  emptyText: string;
};

export function MasterDataList({
  items,
  selectedId,
  emptyText,
}: MasterDataListProps) {
  if (items.length === 0) {
    return (
      <div className="master-list-empty">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="master-list">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="master-list-row"
          data-selected={item.id === selectedId}
        >
          <span className="master-list-main">
            <strong>{item.title}</strong>

            {item.subtitle ? (
              <span>{item.subtitle}</span>
            ) : null}

            {item.meta ? (
              <small>{item.meta}</small>
            ) : null}
          </span>

          {item.status ? (
            <Badge tone={item.tone ?? "neutral"}>
              {item.status}
            </Badge>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
