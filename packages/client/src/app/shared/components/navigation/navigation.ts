import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-navigation',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navigation.html',
  styleUrl: './navigation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Navigation {
  icons = {
    ai: '🤖',
    text: '📝',
    ocr: '🔍',
    generation: '🎨',
    tools: '🔧',
    security: '🛡️',
    iot: '📡',
    codeGen: '⚡',
  };
}

