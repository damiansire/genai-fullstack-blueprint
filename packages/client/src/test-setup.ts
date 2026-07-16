// Vitest global setup. This project is zoneless and tests run under JSDOM.
//
// TestBed needs a one-time test environment before any configureTestingModule
// call. `platformBrowserTesting` (JIT) works under JSDOM: service/DI specs and
// inline-template component specs compile fine. Two known JIT limitations:
// external `templateUrl`/`styleUrl` resources have no loader here, and signal
// inputs (`input()`) are not written by JIT-compiled templates, so specs stay
// at the service/DI level or use inline templates with plain APIs.
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
