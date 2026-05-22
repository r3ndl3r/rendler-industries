# /lib/ansible/callback_plugins/json_to_file.py
import json
import os
from ansible.plugins.callback import CallbackBase

DOCUMENTATION = '''
    callback: json_to_file
    short_description: Write structured JSON stats and errors to a file on playbook finish.
'''


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = 'notification'
    CALLBACK_NAME = 'json_to_file'
    CALLBACK_NEEDS_ENABLED = True

    def __init__(self):
        super(CallbackModule, self).__init__()
        self.failures = []
        self.current_play = ''
        self.task_outputs = []

    def _emit_event(self, payload):
        payload['type'] = payload.get('type', 'event')
        print('@@AUTOMATOR_EVENT@@' + json.dumps(payload, default=str), flush=True)

    def v2_playbook_on_play_start(self, play):
        self.current_play = play.get_name().strip() or 'Play'
        hosts = []
        try:
            hosts = sorted(host.get_name() for host in play.get_variable_manager()._inventory.get_hosts(play.hosts))
        except Exception:
            hosts = []
        self._emit_event({
            'type': 'play_start',
            'play': self.current_play,
            'hosts': hosts,
        })

    def v2_playbook_on_task_start(self, task, is_conditional):
        self._emit_event({
            'type': 'task_start',
            'play': self.current_play,
            'task': task.get_name().strip() or 'Task',
        })

    def v2_runner_on_start(self, host, task):
        self._emit_event({
            'type': 'host_task_start',
            'play': self.current_play,
            'task': task.get_name().strip() or 'Task',
            'host': host.get_name(),
        })

    def _runner_event(self, result, status, ignore_errors=False):
        host = result._host.get_name()
        task = result._task.get_name()
        self._emit_event({
            'type': 'task_result',
            'play': self.current_play,
            'task': task,
            'host': host,
            'status': status,
            'changed': bool(result._result.get('changed')),
            'ignore_errors': bool(ignore_errors),
        })

    def v2_runner_on_ok(self, result):
        self._runner_event(result, 'ok')
        self._capture_task_output(result, 'ok')

    def v2_runner_on_skipped(self, result):
        self._runner_event(result, 'skipped')

    def v2_runner_on_failed(self, result, ignore_errors=False):
        self._runner_event(result, 'failed', ignore_errors)
        if ignore_errors:
            return
        host = result._host.get_name()
        task = result._task.get_name()
        msg = result._result.get('msg') or result._result.get('reason') or str(result._result)
        self.failures.append({
            'host': host,
            'task': task,
            'message': msg
        })

    def v2_runner_on_unreachable(self, result):
        self._runner_event(result, 'unreachable')
        host = result._host.get_name()
        task = result._task.get_name()
        msg = result._result.get('msg') or 'Host unreachable'
        self.failures.append({
            'host': host,
            'task': task,
            'message': msg
        })

    def v2_playbook_on_stats(self, stats):
        hosts = sorted(stats.processed.keys())
        summary = {}
        for host in hosts:
            summary[host] = stats.summarize(host)
        self._emit_event({
            'type': 'run_complete',
            'hosts': hosts,
            'summary': summary,
        })

        export_path = os.environ.get('AUTOMATOR_JSON_EXPORT_PATH')
        if not export_path:
            return

        with open(export_path, 'w', encoding='utf-8') as handle:
            json.dump({
                'stats': summary,
                'failures': self.failures,
                'task_outputs': self.task_outputs,
            }, handle)

    def _capture_task_output(self, result, status):
        host = result._host.get_name()
        task = result._task.get_name()
        res = result._result
        item = res.get('item')
        msg = res.get('msg') or res.get('stdout') or res.get('stdout_lines')
        if msg is None:
            return
        if isinstance(msg, list):
            msg = [str(m) for m in msg]
        else:
            msg = str(msg)
        entry = {
            'host': host,
            'task': task,
            'status': status,
            'changed': bool(res.get('changed')),
            'msg': msg,
        }
        if item is not None:
            entry['item'] = str(item)
        self.task_outputs.append(entry)
