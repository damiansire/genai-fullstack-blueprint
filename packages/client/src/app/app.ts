import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Navigation } from './shared/components/navigation/navigation';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Navigation],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
}