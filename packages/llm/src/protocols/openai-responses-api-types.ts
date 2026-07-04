import type { JSONSchema7 } from '@ai-sdk/provider';

export type OpenAIResponsesIncludeValue =
  | 'web_search_call.action.sources'
  | 'code_interpreter_call.outputs'
  | 'computer_call_output.output.image_url'
  | 'file_search_call.results'
  | 'message.input_image.image_url'
  | 'message.output_text.logprobs'
  | 'reasoning.encrypted_content';

export interface OpenAIResponsesProviderOptions {
  include?: OpenAIResponsesIncludeValue[] | null;
  instructions?: string | null;
  maxToolCalls?: number | null;
  metadata?: Record<string, unknown> | null;
  parallelToolCalls?: boolean | null;
  previousResponseId?: string | null;
  promptCacheKey?: string | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | null;
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | null;
  safetyIdentifier?: string | null;
  serviceTier?: 'auto' | 'flex' | 'priority' | null;
  store?: boolean | null;
  strictJsonSchema?: boolean | null;
  textVerbosity?: 'low' | 'medium' | 'high' | null;
  user?: string | null;
}

export type OpenAIResponsesInputItem =
  | { role: 'system' | 'developer'; content: string }
  | { role: 'user'; content: OpenAIResponsesUserContentPart[] }
  | { role: 'assistant'; content: OpenAIResponsesAssistantContentPart[]; id?: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string; id?: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'reasoning'; id: string; encrypted_content?: string | null; summary: { type: 'summary_text'; text: string }[] }
  | { type: 'item_reference'; id: string }
  | { type: 'mcp_approval_response'; approval_request_id: string; approve: boolean };

export type OpenAIResponsesUserContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; file_url: string }
  | { type: 'input_file'; filename?: string; file_data: string };

export type OpenAIResponsesAssistantContentPart =
  | { type: 'output_text'; text: string }
  | { type: 'refusal'; refusal: string };

export type OpenAIResponsesTool =
  | {
      type: 'function';
      name: string;
      description?: string;
      parameters: JSONSchema7;
      strict?: boolean;
    }
  | ({
      type:
        | 'web_search'
        | 'web_search_preview'
        | 'code_interpreter'
        | 'image_generation'
        | 'file_search'
        | 'computer_use_preview'
        | 'local_shell';
    } & Record<string, unknown>);

export interface OpenAIResponsesRequest {
  model: string;
  input: OpenAIResponsesInputItem[];
  stream?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  text?: {
    format?:
      | { type: 'json_object' }
      | {
          type: 'json_schema';
          name: string;
          description?: string;
          schema: JSONSchema7;
          strict?: boolean;
        };
    verbosity?: 'low' | 'medium' | 'high';
  };
  tools?: OpenAIResponsesTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; name: string };
  max_tool_calls?: number;
  metadata?: Record<string, unknown>;
  parallel_tool_calls?: boolean;
  previous_response_id?: string;
  store?: boolean;
  user?: string;
  instructions?: string;
  service_tier?: 'auto' | 'flex' | 'priority';
  include?: OpenAIResponsesIncludeValue[];
  prompt_cache_key?: string;
  safety_identifier?: string;
  reasoning?: { effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'minimal'; summary?: 'auto' | 'concise' | 'detailed' };
}

export interface OpenAIResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number | null } | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
}

export type OpenAIResponsesAnnotation =
  | { type: 'url_citation'; url: string; title: string }
  | {
      type: 'file_citation';
      file_id: string;
      filename?: string | null;
      quote?: string | null;
      index?: number | null;
      start_index?: number | null;
      end_index?: number | null;
    };

export type OpenAIResponsesOutputItem =
  | {
      type: 'message';
      role: 'assistant';
      id: string;
      content: { type: 'output_text'; text: string; annotations?: OpenAIResponsesAnnotation[] | null }[];
    }
  | { type: 'reasoning'; id: string; encrypted_content?: string | null; summary: { type: 'summary_text'; text: string }[] }
  | { type: 'function_call'; id: string; call_id: string; name: string; arguments: string; status?: string }
  | { type: 'web_search_call'; id: string; status?: string; action?: Record<string, unknown> | null }
  | { type: 'file_search_call'; id: string; status?: string; queries?: string[]; results?: unknown[] | null }
  | { type: 'image_generation_call'; id: string; result?: string; status?: string }
  | { type: 'code_interpreter_call'; id: string; code?: string | null; container_id?: string; outputs?: unknown[] | null; status?: string }
  | { type: 'local_shell_call'; id: string; call_id: string; action: Record<string, unknown> }
  | { type: 'computer_call'; id: string; status?: string };

export interface OpenAIResponsesResponse {
  id: string;
  created_at: number;
  model: string;
  output: OpenAIResponsesOutputItem[];
  usage?: OpenAIResponsesUsage;
  service_tier?: string | null;
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
}

export type OpenAIResponsesStreamEvent =
  | { type: 'response.created'; response: { id: string; created_at: number; model: string; service_tier?: string | null } }
  | { type: 'response.output_text.delta'; item_id: string; delta: string }
  | { type: 'response.output_text.annotation.added'; annotation: OpenAIResponsesAnnotation }
  | { type: 'response.output_item.added'; output_index: number; item: OpenAIResponsesOutputItem }
  | { type: 'response.output_item.done'; output_index: number; item: OpenAIResponsesOutputItem }
  | { type: 'response.function_call_arguments.delta'; item_id: string; output_index: number; delta: string }
  | { type: 'response.reasoning_summary_part.added'; item_id: string; summary_index: number }
  | { type: 'response.reasoning_summary_text.delta'; item_id: string; summary_index: number; delta: string }
  | { type: 'response.completed' | 'response.done' | 'response.incomplete'; response: { usage?: OpenAIResponsesUsage; incomplete_details?: { reason?: string } | null; service_tier?: string | null } }
  | { type: 'response.failed' | 'error'; error?: { code?: string; message?: string }; message?: string; response?: { error?: { code?: string; message?: string }; incomplete_details?: { reason?: string } | null } }
  | ({ type: string } & Record<string, unknown>);
