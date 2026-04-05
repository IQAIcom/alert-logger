import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'

export interface RequestContext {
  requestId: string
  method: string
  path: string
}

export const requestStore = new AsyncLocalStorage<RequestContext>()

@Injectable()
export class AlertContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const context: RequestContext = {
      requestId: (() => {
        const rawId = req.headers['x-request-id']
        return (Array.isArray(rawId) ? rawId[0] : rawId) ?? randomUUID()
      })(),
      method: req.method,
      path: req.originalUrl ?? req.url,
    }

    requestStore.run(context, next)
  }
}
