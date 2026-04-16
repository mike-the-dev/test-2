// Set required public env vars BEFORE any module that reads them is loaded.
process.env.NEXT_PUBLIC_CHAT_API_URL = "http://localhost:8081";

import "@testing-library/jest-dom/vitest";
