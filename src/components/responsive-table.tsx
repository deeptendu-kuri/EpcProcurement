import { Children, cloneElement, isValidElement, type ReactNode } from "react";

type CellProps = { children?: ReactNode; colSpan?: number; "data-label"?: string };

function textOf(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<CellProps>(child) ? textOf(child.props.children) : "";
  }).join("");
}

export function ResponsiveTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  const sections = Children.toArray(children);
  const head = sections.find((node) => isValidElement(node) && node.type === "thead");
  const headerRow = isValidElement<CellProps>(head) ? Children.toArray(head.props.children)[0] : null;
  const labels = isValidElement<CellProps>(headerRow)
    ? Children.toArray(headerRow.props.children).map(textOf) : [];

  const content = sections.map((section) => {
    if (!isValidElement<CellProps>(section) || section.type !== "tbody") return section;
    return cloneElement(section, {}, Children.map(section.props.children, (row) => {
      if (!isValidElement<CellProps>(row) || row.type !== "tr") return row;
      return cloneElement(row, {}, Children.map(row.props.children, (cell, index) => {
        if (!isValidElement<CellProps>(cell) || cell.type !== "td") return cell;
        return cloneElement(cell, { "data-label": cell.props.colSpan ? undefined : labels[index] });
      }));
    }));
  });

  return <div className={`responsive-records${labels.length > 6 ? " wide-records" : ""}`}><table className={className.replace(/min-w-\[\d+px\]/g, "")}>
    {content}
  </table></div>;
}
