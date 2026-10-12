import { Component, type ErrorInfo, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: '' };
  static getDerivedStateFromError(error: Error) { return { message: error.message }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Credentials and prompt state are never sent to remote error reporting. */ }
  render() {
    return this.state.message ? <section className="panel" role="alert"><h2>This view could not render</h2><p>{this.state.message}</p><button className="button" onClick={() => this.setState({ message: '' })}>Try again</button></section> : this.props.children;
  }
}
