import type { FastifyInstance } from 'fastify';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, LocationAck, ServerToClientEvents } from '@rideloc/shared';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('server is not listening on a TCP port');
  return `http://127.0.0.1:${addr.port}`;
}

export function connectClient(url: string, token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: ClientSocket = io(url, {
      auth: token === undefined ? {} : { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

export function sendLocation(socket: ClientSocket, payload: unknown): Promise<LocationAck> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ack timeout')), 3000);
    socket.emit('driver:location', payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

export function waitForEvent(
  socket: ClientSocket,
  event: 'session:expired' | 'disconnect',
  ms = 6000,
) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
