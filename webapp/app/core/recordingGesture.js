/* Single-tap to start/stop, double-tap to switch mode. One permission request per recording. */
export function bindTapControl(button, { onSingle, onDouble, delay = 300 }) {
  let timer = null;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const activate = () => {
    if (button.disabled) return;
    if (timer) {
      clear();
      onDouble?.();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      onSingle?.();
    }, delay);
  };
  button.addEventListener('click', (event) => {
    event.preventDefault();
    activate();
  });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  return { cancel: clear, reset: clear };
}
