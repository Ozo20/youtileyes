import Link from "next/link";
import { Plus, Search } from "lucide-react";

type MasterDataToolbarProps = {
  newHref: string;
  newLabel: string;
  query?: string;
  placeholder?: string;
};

export function MasterDataToolbar({
  newHref,
  newLabel,
  query,
  placeholder = "Search",
}: MasterDataToolbarProps) {
  return (
    <div className="master-toolbar">
      <form method="get" className="master-search">
        <Search size={15} />

        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder={placeholder}
        />
      </form>

      <Link
        href={newHref}
        className="ui-button ui-button-primary master-new-link"
      >
        <Plus size={14} />
        {newLabel}
      </Link>
    </div>
  );
}
