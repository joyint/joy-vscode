import * as vscode from 'vscode';
import type { JoyClient } from './joyClient';
import type { JoyEnvelope } from './types';

export interface JoyAuthStatus {
  authenticated: boolean;
  member: string;
  session_present: boolean;
  expires_in_seconds: number | null;
  auth_initialized: boolean;
}

export type AuthState =
  | { kind: 'unknown' }
  | { kind: 'unauthenticated'; member: string }
  | { kind: 'authenticated'; member: string; expiresInSeconds: number | null };

/**
 * Wraps `joy auth` for the extension: status queries plus a modal passphrase
 * prompt (masked input, eye button to reveal, inline error on a wrong
 * passphrase) feeding `joy auth --passphrase-stdin`.
 */
export class AuthService {
  private state: AuthState = { kind: 'unknown' };
  private pendingPrompt: Promise<boolean> | undefined;
  private readonly emitter = new vscode.EventEmitter<AuthState>();
  readonly onDidChangeState = this.emitter.event;

  constructor(private readonly client: JoyClient) {}

  currentState(): AuthState {
    return this.state;
  }

  async refreshStatus(): Promise<AuthState> {
    try {
      const response = await this.client.runJsonAllowFailure<JoyEnvelope<JoyAuthStatus>>(
        ['auth', 'status'],
        { noAuthRetry: true },
      );
      const status = response.data;
      this.setState(
        status.authenticated
          ? {
              kind: 'authenticated',
              member: status.member,
              expiresInSeconds: status.expires_in_seconds,
            }
          : { kind: 'unauthenticated', member: status.member },
      );
    } catch {
      this.setState({ kind: 'unknown' });
    }
    return this.state;
  }

  /**
   * Show the passphrase modal. Concurrent callers share one prompt. Resolves
   * true once a session was established, false when the user dismissed it.
   */
  promptAndAuthenticate(): Promise<boolean> {
    this.pendingPrompt ??= this.showPrompt().finally(() => {
      this.pendingPrompt = undefined;
    });
    return this.pendingPrompt;
  }

  private showPrompt(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const revealButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('eye'),
        tooltip: 'Show passphrase',
      };
      const hideButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('eye-closed'),
        tooltip: 'Hide passphrase',
      };

      const box = vscode.window.createInputBox();
      box.title = 'Joy: Authenticate';
      box.prompt =
        this.state.kind === 'unauthenticated'
          ? `Passphrase for ${this.state.member} (session lasts 24h)`
          : 'Enter your Joy passphrase (session lasts 24h)';
      box.password = true;
      box.buttons = [revealButton];
      box.ignoreFocusOut = true;

      let settled = false;
      const finish = (result: boolean): void => {
        if (!settled) {
          settled = true;
          box.hide();
          box.dispose();
          resolve(result);
        }
      };

      box.onDidTriggerButton((button) => {
        box.password = button === revealButton ? false : true;
        box.buttons = [button === revealButton ? hideButton : revealButton];
      });

      box.onDidAccept(() => {
        const passphrase = box.value;
        if (passphrase.length === 0) {
          box.validationMessage = 'Passphrase must not be empty.';
          return;
        }
        box.busy = true;
        box.enabled = false;
        box.validationMessage = undefined;
        void this.client
          .run(['auth', '--passphrase-stdin'], { stdin: `${passphrase}\n`, noAuthRetry: true })
          .then(async () => {
            await this.refreshStatus();
            finish(true);
          })
          .catch((err: unknown) => {
            box.busy = false;
            box.enabled = true;
            box.value = '';
            box.validationMessage =
              err instanceof Error && err.message.trim().length > 0
                ? err.message.trim()
                : 'Authentication failed.';
          });
      });

      box.onDidHide(() => finish(false));
      box.show();
    });
  }

  private setState(state: AuthState): void {
    this.state = state;
    this.emitter.fire(state);
  }
}
