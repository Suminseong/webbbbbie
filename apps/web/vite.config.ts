import { defineConfig } from "vite";

// GitHub Pages 배포는 /<저장소명>/ 아래에서 서비스되므로 워크플로에서 VITE_BASE로 지정한다.
// 로컬 개발·테스트는 기본값 "/"를 그대로 사용한다.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
});
