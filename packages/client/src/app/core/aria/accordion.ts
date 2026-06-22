import { Directive, signal, input, inject } from '@angular/core';

@Directive({
  selector: '[ngAccordionGroup]',
})
export class AccordionGroup {
  readonly multiExpandable = input(false);
  // This headless group manages the state
  private activePanels = new Set<AccordionTrigger>();

  toggle(trigger: AccordionTrigger) {
    if (trigger.expanded()) {
      trigger.expanded.set(false);
      this.activePanels.delete(trigger);
    } else {
      if (!this.multiExpandable()) {
        this.activePanels.forEach((p) => p.expanded.set(false));
        this.activePanels.clear();
      }
      trigger.expanded.set(true);
      this.activePanels.add(trigger);
    }
  }
}

@Directive({
  selector: '[ngAccordionTrigger]',
  host: {
    '[attr.aria-expanded]': 'expanded()',
    role: 'button',
    tabindex: '0',
    '(click)': 'onClick()',
    '(keydown.space)': 'onClick()',
    '(keydown.enter)': 'onClick()',
  },
})
export class AccordionTrigger {
  expanded = signal(false);
  private group = inject(AccordionGroup, { optional: true });

  onClick() {
    if (this.group) {
      this.group.toggle(this);
    } else {
      this.expanded.update((v) => !v);
    }
  }
}

@Directive({
  selector: '[ngAccordionPanel]',
  host: {
    role: 'region',
    '[hidden]': '!trigger()?.expanded()',
  },
})
export class AccordionPanel {
  readonly trigger = input.required<AccordionTrigger>({ alias: 'ngAccordionPanel' });
}
