import { Component, computed, inject, ChangeDetectionStrategy, output, input } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { API_CONFIG } from '../../../core/tokens/api-config';
import { CommonModule } from '@angular/common';
import { ChatSession } from '../../../core/types/chat.types';

@Component({
  selector: 'app-chat-sidebar',
  imports: [CommonModule],
  template: `
    <aside class="chat-sidebar">
      <div class="sidebar-header">
        <h3>Chat History</h3>
        <button class="new-chat-btn" (click)="onNewChat.emit()">
          <span aria-hidden="true">➕</span> New Chat
        </button>
      </div>

      <div class="session-list">
        @if (isLoading()) {
          <div class="loading">Loading sessions...</div>
        } @else {
          @for (session of sessions(); track session.id) {
            <button 
              class="session-btn" 
              [class.active]="activeSessionId() === session.id"
              [attr.aria-current]="activeSessionId() === session.id ? 'page' : null"
              (click)="onSelectSession.emit(session.id)">
              <span class="icon">💬</span>
              <span class="title">{{ session.title }}</span>
              <span class="date">{{ session.updated_at | date:'shortTime' }}</span>
            </button>
          } @empty {
            <div class="empty">No past conversations.</div>
          }
        }
      </div>
    </aside>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      border-right: 1px solid var(--border-color);
      background: var(--surface-2);
      width: 250px;
      flex-shrink: 0;
    }
    .chat-sidebar {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .sidebar-header {
      padding: 1rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    h3 {
      margin: 0;
      font-size: 0.85rem;
      text-transform: uppercase;
      color: var(--text-2);
    }
    .new-chat-btn {
      width: 100%;
      padding: 0.5rem;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: var(--surface-1);
      color: var(--text-1);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    .new-chat-btn:hover {
      background: var(--surface-3);
    }
    .session-list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .session-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border: none;
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    .session-btn:hover {
      background: var(--surface-3);
    }
    .session-btn.active {
      background: var(--primary-color-alpha);
      color: var(--text-1);
      border-left: 3px solid var(--primary-color);
    }
    .title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.9rem;
    }
    .date {
      font-size: 0.7rem;
      color: var(--text-3);
    }
    .empty, .loading {
      padding: 2rem 1rem;
      text-align: center;
      color: var(--text-3);
      font-size: 0.85rem;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatSidebar {
  private readonly apiConfig = inject(API_CONFIG);

  activeSessionId = input<string | null>(null);
  
  onSelectSession = output<string>();
  onNewChat = output<void>();

  sessionsResource = httpResource<ChatSession[]>(() => ({
    url: `${this.apiConfig.baseUrl}/sessions`,
    method: 'GET'
  }));

  sessions = computed(() => this.sessionsResource.value() ?? []);
  isLoading = computed(() => this.sessionsResource.isLoading());
  
  reload() {
    this.sessionsResource.reload();
  }
}
