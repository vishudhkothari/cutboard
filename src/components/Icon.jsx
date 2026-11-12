const paths = {
  clipboard: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18M7 14l3-4 3 2 5-6" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m9 3 .7-1h4.6l.7 3 2 .9 2.6-.8 2.3 4-2 2v2.1l2 2-2.3 4-2.6-.8-2 .9-.7 2.7H9.7L9 19l-2-.9-2.6.8-2.3-4 2-2v-2.1l-2-2 2.3-4 2.6.8L9 5Z" />
    </>
  ),
  export: (
    <>
      <path d="M12 16V3m-4 4 4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4m-5-4h12" />
    </>
  ),
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  sparkle: (
    <>
      <path d="m12 3 1.4 4.3L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4ZM19 14.5l.7 2.1 2.1.7-2.1.7L19 20l-.7-2-2.1-.7 2.1-.7Z" />
    </>
  ),
  scale: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="4" />
      <path d="M8 8a5 5 0 0 1 8 0m-4 3 2-3" />
    </>
  ),
  steps: (
    <>
      <path d="M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0ZM20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M8 2v4m8-4v4M3 10h18" />
    </>
  ),
};

export default function Icon({ name, size = 18, className = "" }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
