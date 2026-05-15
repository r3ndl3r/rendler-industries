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

    def v2_runner_on_failed(self, result, ignore_errors=False):
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
        host = result._host.get_name()
        task = result._task.get_name()
        msg = result._result.get('msg') or 'Host unreachable'
        self.failures.append({
            'host': host,
            'task': task,
            'message': msg
        })

    def v2_playbook_on_stats(self, stats):
        export_path = os.environ.get('AUTOMATOR_JSON_EXPORT_PATH')
        if not export_path:
            return
        hosts = sorted(stats.processed.keys())
        summary = {}
        for host in hosts:
            summary[host] = stats.summarize(host)
        
        with open(export_path, 'w', encoding='utf-8') as handle:
            json.dump({
                'stats': summary,
                'failures': self.failures
            }, handle)
