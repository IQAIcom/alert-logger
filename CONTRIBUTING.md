# Contributing to @iqai/alert-logger

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/IQAIcom/alert-logger.git
cd alert-logger
npm install
```

## Scripts

```bash
npm test          # Run tests
npm run test:watch # Run tests in watch mode
npm run lint      # Type check
npm run build     # Build with tsup
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Write your changes
3. Add tests for new functionality
4. Ensure all tests pass: `npm test`
5. Ensure types check: `npm run lint`
6. Submit a pull request

## Writing Adapters

To create a custom adapter, implement the `AlertAdapter` interface:

```ts
import type { AlertAdapter, FormattedAlert, AlertLevel } from '@iqai/alert-logger'

class MyAdapter implements AlertAdapter {
  readonly name = 'my-adapter'
  levels: AlertLevel[] = ['info', 'warning', 'critical']

  rateLimits() {
    return { maxPerWindow: 60, windowMs: 60_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    // Your sending logic here
  }
}
```

## Code Style

- TypeScript strict mode
- ESM with `.js` extensions in imports
- No external runtime dependencies in core

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
