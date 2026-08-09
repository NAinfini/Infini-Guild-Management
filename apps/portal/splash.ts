export function dismissSplash(): void {
  document.getElementById("splash")?.remove();

  const root = document.getElementById("root");
  if (root) {
    root.style.opacity = "1";
    root.style.position = "";
    root.style.inset = "";
  }

  document.documentElement.classList.add("splash-done");
}
