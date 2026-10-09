import { Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { IntentService } from './intent.service.js';
import { AnthropicLLMProvider, DisabledLLMProvider, LLM_PROVIDER } from '@seo/llm';

@Global()
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        env.ANTHROPIC_API_KEY && env.NODE_ENV !== 'test'
          ? new AnthropicLLMProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL)
          : new DisabledLLMProvider(),
    },
    IntentService,
  ],
  exports: [LLM_PROVIDER, IntentService],
})
export class LlmModule {}
