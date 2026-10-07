import { z } from 'zod';
import { agentTodo, agentConnectionDraft } from '../../protocol/src/index.js';
const id=z.string().min(1).max(128);
const target={runtimeId:z.string().uuid(),connectionId:z.string().uuid()};
const columns=z.array(z.string().max(4096)).max(1000);
const step=z.object({status:z.enum(['pending','running','succeeded','failed','skipped','cancelled','outcome_unknown']),columns:columns.optional(),affectedRows:z.number().finite().optional(),truncated:z.boolean().optional(),rolledBack:z.boolean().optional(),error:z.string().max(4000).optional(),resultAvailable:z.boolean().optional()});
export const executionStateOutput=z.object({id:id.optional(),status:z.enum(['running','succeeded','failed','cancelled','outcome_unknown']),results:z.array(step).max(256).optional(),updatedAt:z.number().optional(),resultAvailable:z.boolean().optional()});
const planSteps=z.array(z.object({sql:z.string().max(20000),kind:z.enum(['read','write','schema','transaction','unknown']),decision:z.enum(['allow','ask','deny'])})).max(256);
const result=z.object({...target,executionId:id,setId:z.number().int().nonnegative(),columns,rows:z.array(z.array(z.unknown()).max(1000)).max(50),truncated:z.boolean(),selectedByUser:z.literal(true).optional()});
/** All schemas strip undeclared fields at the model boundary. Never spread raw Runtime data into a prompt. */
export const toolOutputSchemas={
 update_todo:z.object({items:z.array(agentTodo).max(12),planningOnly:z.literal(true)}),
 command_reference:z.object({command:z.enum(['ls','pwd','head','tail','grep','wc']),example:z.string(),description:z.string(),executed:z.literal(false),referenceOnly:z.literal(true)}),
 request_connection:z.object({draft:agentConnectionDraft,created:z.literal(false),requiresUserInput:z.literal(true)}),
 list_connections:z.object({runtimeId:z.string().uuid(),connections:z.array(z.object({id:z.string().uuid(),name:z.string(),engine:z.enum(['sqlite','postgres','mysql']),version:z.number().int(),database:z.string().optional()})).max(100)}),
 connect_database:z.object({...target,connected:z.literal(true),persistentSession:z.literal(false)}),
 list_databases:z.object({...target,databases:z.array(z.object({name:z.string()})).max(1000),truncated:z.boolean().optional()}),
 search_schema:z.object({...target,database:z.string(),tables:z.array(z.object({schema:z.string(),name:z.string(),columns:z.array(z.never()).max(0)})).max(200),nextCursor:z.string().max(4096).optional(),scanned:z.number().int().nonnegative().max(1000),truncated:z.boolean()}),
 describe_table:z.object({...target,database:z.string(),tables:z.array(z.object({schema:z.string(),name:z.string(),columns:z.array(z.object({name:z.string(),type:z.string(),nullable:z.boolean()})).max(1000)})).max(1),truncated:z.boolean()}),
 propose_sql:z.object({...target,database:z.string().optional(),planId:id,steps:planSteps,status:z.literal('prepared'),requiresUserApproval:z.boolean()}),
 execute_plan:z.union([z.object({...target,database:z.string().optional(),planId:id,steps:planSteps,status:z.literal('awaiting_approval')}),z.object({...target,executionId:id,replayed:z.boolean().optional()})]),
 get_execution_status:executionStateOutput.extend(target),
 get_result:result,
 get_selected_result:result,
 cancel_query:z.object({status:z.enum(['cancel_pending','running','succeeded','failed','cancelled','outcome_unknown']),accepted:z.boolean(),mode:z.string().optional()}),
};
