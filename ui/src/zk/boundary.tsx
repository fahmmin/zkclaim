// Catches a render crash anywhere in the app: shows the error and a Reload button instead of a blank page, logs the
// component stack, and keeps the last crash in localStorage (`zkclaim-last-crash`) so it can be read after reloading.
import { Component, type ErrorInfo, type ReactNode } from 'react';

type State = { error: Error | null; components: string };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, components: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const components = info.componentStack ?? '';
    console.error('[zkclaim] the app crashed:', error, components);
    this.setState({ components });
    try {
      localStorage.setItem('zkclaim-last-crash', JSON.stringify({ at: new Date().toISOString(), message: error.message, stack: error.stack, components }));
    } catch {
      // storage full or blocked: the screen still shows the error
    }
  }

  render() {
    const { error, components } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="zk">
        <main className="page crash">
          <section className="card t-tomato" role="alert">
            <div className="meta">
              <span>The app stopped</span>
              <span>Nothing on-chain is affected</span>
            </div>
            <h1 className="hl m">Something on this screen failed</h1>
            <p className="data">{error.message || String(error)}</p>
            <p className="lede">Reload to continue. In Live mode, connect 1AM again and join your contract: its address, your keys and your records are kept in this browser.</p>
            <div className="row">
              <button className="btn big" onClick={() => location.reload()}>
                Reload
              </button>
            </div>
            <details>
              <summary>Technical details</summary>
              <pre>
                {error.stack}
                {components}
              </pre>
            </details>
          </section>
        </main>
      </div>
    );
  }
}
