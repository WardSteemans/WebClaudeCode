import type { AppEvent, SessionInitEvent, SessionStatusEvent, ThinkingTokensEvent, TaskStartedEvent, TaskCompletedEvent } from '@cc-gui/shared';
import type { ParserState } from './state.js';
import type { RawSystemEvent } from './eventTypes.js';
import { createLogger } from '../../logger.js';

const log = createLogger('eventParser:system');

export function* parseSystemEvent(evt: RawSystemEvent, sessionId: string, id: string, ts: string, s: ParserState): Generator<AppEvent> {
  switch (evt.subtype) {
    case 'init': {
      const agents: string[] = evt.agents || [];
      const tools: string[] = evt.tools || [];
      s.agents = agents;
      s.tools = tools;

      const init: SessionInitEvent = {
        id, timestamp: ts, sessionId,
        type: 'session.init',
        cwd: evt.cwd || '',
        model: evt.model || '',
        tools,
        agents,
        skills: evt.skills || [],
        slashCommands: evt.slash_commands || [],
        mcpServers: (evt.mcp_servers || []).map((m: any) => ({ name: m.name || '', status: m.status || '' })),
        permissionMode: evt.permissionMode || '',
      };
      yield init;
      break;
    }

    case 'status': {
      const status: SessionStatusEvent = {
        id, timestamp: ts, sessionId,
        type: 'session.status',
        status: evt.status || '',
      };
      yield status;
      break;
    }

    case 'thinking_tokens': {
      const tt: ThinkingTokensEvent = {
        id, timestamp: ts, sessionId,
        type: 'thinking.tokens',
        estimatedTokens: evt.estimated_tokens || 0,
        estimatedTokensDelta: evt.estimated_tokens_delta || 0,
      };
      yield tt;
      break;
    }

    case 'task_started': {
      const task: TaskStartedEvent = {
        id, timestamp: ts, sessionId,
        type: 'task.started',
        taskId: evt.task_id || '',
        toolUseId: evt.tool_use_id || '',
        description: evt.description || '',
        taskType: evt.task_type || '',
      };
      yield task;
      break;
    }

    case 'task_notification': {
      const task: TaskCompletedEvent = {
        id, timestamp: ts, sessionId,
        type: 'task.completed',
        taskId: evt.task_id || '',
        toolUseId: evt.tool_use_id || '',
        status: evt.status || '',
        summary: evt.summary || '',
        outputFile: evt.output_file || '',
      };
      yield task;
      break;
    }

    case 'api_error':
      log.warn('API error event', { sessionId: sessionId.slice(0, 8), message: evt.message || evt.error });
      yield {
        type: 'session.error',
        message: evt.message || evt.error || 'API error',
        code: 'api_error',
        id, timestamp: ts, sessionId,
      };
      break;

    case 'compact_boundary': {
      yield {
        type: 'session.compacted',
        tokensRemoved: evt.tokens_removed ?? evt.token_removed ?? undefined,
        inputTokens: evt.input_tokens ?? undefined,
        outputTokens: evt.output_tokens ?? undefined,
        messageCount: evt.messages ?? evt.message_count ?? undefined,
        id, timestamp: ts, sessionId,
      };
      break;
    }
  }
}
