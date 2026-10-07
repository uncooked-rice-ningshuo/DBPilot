const { contextBridge, ipcRenderer } = require('electron');

const operations = [
  'ai.settings', 'ai.configure', 'ai.models', 'policy.get', 'policy.update', 'runtime.info', 'connections.list', 'connections.create', 'connections.update', 'connections.delete',
  'connections.test', 'connections.testDraft', 'connections.databases', 'connections.tables', 'connections.schema', 'plans.prepare', 'plans.get', 'approvals.decide',
  'executions.start', 'executions.list', 'executions.get', 'executions.cancel', 'executions.resultPage', 'ai.draft', 'ai.analysis',
  'ai.test', 'ai.list', 'ai.start', 'ai.get', 'ai.resume', 'ai.cancel'
];
const api = Object.fromEntries(operations.map(operation => [operation, input => ipcRenderer.invoke('dbpilot:invoke', operation, input)]));
api.getTarget = () => ipcRenderer.invoke('dbpilot:target:get');
api.setTarget = target => ipcRenderer.invoke('dbpilot:target:set', target);
api.copyText = text => ipcRenderer.invoke('dbpilot:clipboard:write', text);
api.pickSqliteFile = () => ipcRenderer.invoke('dbpilot:sqlite:pick');
contextBridge.exposeInMainWorld('dbpilotDesktop', api);
