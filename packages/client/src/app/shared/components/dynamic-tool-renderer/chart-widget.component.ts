import { Component, input } from '@angular/core';

@Component({
  selector: 'app-chart-widget',
  template: `
    <div class="chart-container">
      <h3 class="chart-title">
        <span aria-hidden="true" class="pulse-icon">📊</span>
        {{ label() }}
      </h3>
      <div class="chart-bars">
        @for (val of data(); track $index; let i = $index) {
          <div class="chart-bar-wrapper">
            <div class="chart-bar" 
                 [style.height.%]="val"
                 [style.animation-delay.ms]="i * 100">
              <span class="chart-value">{{ val }}</span>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .chart-container {
      position: relative;
      margin-top: 1.5rem;
      padding: 1.5rem;
      border-radius: 1.5rem;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px rgba(31, 38, 135, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.4);
      overflow: hidden;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
      
      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 40px rgba(31, 38, 135, 0.08);
      }
    }

    .chart-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 1.5rem 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      
      .pulse-icon {
        display: inline-block;
        animation: subtlePulse 2s infinite ease-in-out;
      }
    }

    .chart-bars {
      display: flex;
      align-items: flex-end;
      gap: 1rem;
      height: 12rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid rgba(0, 0, 0, 0.05);
    }

    .chart-bar-wrapper {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      group: hover;
    }

    .chart-bar {
      width: 100%;
      max-width: 3rem;
      border-radius: 0.5rem 0.5rem 0 0;
      background: linear-gradient(180deg, #6366f1 0%, #a855f7 100%);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 0.5rem;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
      position: relative;
      animation: growUp 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      transform-origin: bottom;
      opacity: 0;
      transition: filter 0.3s ease, transform 0.3s ease;

      &:hover {
        filter: brightness(1.2);
        transform: scaleY(1.05);
      }
    }

    .chart-value {
      color: white;
      font-size: 0.75rem;
      font-weight: 700;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      opacity: 0;
      animation: fadeIn 0.3s ease forwards;
      animation-delay: 0.8s;
    }

    @keyframes growUp {
      0% { transform: scaleY(0); opacity: 0; }
      100% { transform: scaleY(1); opacity: 1; }
    }

    @keyframes fadeIn {
      to { opacity: 1; }
    }

    @keyframes subtlePulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
  `]
})
export class ChartWidgetComponent {
  data = input<number[]>([]);
  label = input<string>('Chart');
}
