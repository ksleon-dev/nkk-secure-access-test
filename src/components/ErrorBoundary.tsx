import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Catches any render error so an employee sees a calm, branded message with a
// reload button instead of a blank window. A customer must never see a crash.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render-Fehler:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="text-[15px] font-bold text-[color:var(--brand-fg)]">
            Etwas ist schiefgelaufen.
          </div>
          <p className="text-[12px] text-[color:var(--brand-fg)]/70 leading-relaxed max-w-[85%]">
            Die App konnte diese Ansicht nicht laden. Ein Neustart behebt das
            meist. Wenn es bleibt, melde dich bitte beim Support.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary rounded-lg px-5 py-2.5 text-[13px] font-semibold"
          >
            Neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
