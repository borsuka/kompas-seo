import './instrument.js';
import { createApp } from './app.factory.js';
import { API_ENV, type ApiEnv } from './config/env.js';

const app = await createApp();
const env = app.get<ApiEnv>(API_ENV);
await app.listen(env.API_PORT);
