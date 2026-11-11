import type { SVGProps } from "react";

export type IconName =
  | "overview"
  | "schemas"
  | "palette"
  | "keys"
  | "fuzzy"
  | "shuangpin"
  | "punctuation"
  | "dictionary"
  | "advanced"
  | "diagnostics"
  | "deploy"
  | "snapshot"
  | "folder"
  | "check"
  | "warning"
  | "chevron"
  | "external"
  | "plus"
  | "search";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, React.ReactNode> = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  schemas: (
    <>
      <path d="M4 5.5h16" />
      <path d="M4 12h16" />
      <path d="M4 18.5h16" />
      <circle cx="7" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.2a1.8 1.8 0 0 0 0-3.6h-.7a1.4 1.4 0 0 1 0-2.8h2.3A5.7 5.7 0 0 0 20.5 8.4 5.7 5.7 0 0 0 14.8 3.5Z" />
      <circle cx="7.6" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="6.9" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="7.3" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  keys: (
    <>
      <rect x="2.8" y="6" width="18.4" height="12" rx="2.2" />
      <path d="M6.4 10h.01M9.6 10h.01M12.8 10h.01M16 10h.01M6.4 13.4h.01M9.6 13.4h.01M12.8 13.4h.01M16 13.4h.01" />
      <path d="M8 16.2h8" />
    </>
  ),
  fuzzy: (
    <>
      <path d="M3 12c1.4-4 2.6-4 4 0s2.6 4 4 0 2.6-4 4 0 2.6 4 4 0" />
    </>
  ),
  shuangpin: (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2.2" />
      <path d="M3 9h18M3 14.5h18M9 3.5v17M15 3.5v17" />
    </>
  ),
  punctuation: (
    <>
      <path d="M7.5 7.5c-1.6 0-2.8 1.2-2.8 2.8 0 1.4 1 2.5 2.4 2.7-.2 1.6-1.2 2.6-2.6 3.3" />
      <path d="M16.5 7.5c-1.6 0-2.8 1.2-2.8 2.8 0 1.4 1 2.5 2.4 2.7-.2 1.6-1.2 2.6-2.6 3.3" />
    </>
  ),
  dictionary: (
    <>
      <path d="M4.5 5.5A2 2 0 0 1 6.5 3.5H19v17H6.5a2 2 0 0 1-2-2Z" />
      <path d="M4.5 17.5a2 2 0 0 1 2-2H19" />
      <path d="M8.5 7.5h6" />
    </>
  ),
  advanced: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  diagnostics: (
    <>
      <path d="M3 12h3.2l2.2-5.4L12 18l2.4-8 1.6 2h4.8" />
    </>
  ),
  deploy: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.8 10.8 4.2 4.2 4.2-4.2" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  snapshot: (
    <>
      <path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v9.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.7Z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 6.8A1.8 1.8 0 0 1 5.3 5h4.1l2 2.2h7.3a1.8 1.8 0 0 1 1.8 1.8v8.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8Z" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  warning: (
    <>
      <path d="M12 4.2 21 19.8H3Z" />
      <path d="M12 9.5v4.4M12 17h.01" />
    </>
  ),
  chevron: <path d="m9.5 5.5 7 6.5-7 6.5" />,
  external: (
    <>
      <path d="M13.5 4.5H19.5v6" />
      <path d="m19 5-9 9" />
      <path d="M18 14v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2V7.8A1.8 1.8 0 0 1 5.8 6H10" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.6 15.6 4 4" />
    </>
  ),
};

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
