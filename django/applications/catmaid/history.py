
import functools
import re

from django.db import connection
from django.db.transaction import TransactionManagementError

from catmaid import locks

transaction_label_pattern = re.compile(r'^\w+\.\w+$')


def fail_on_wrong_format_label(label) -> None:
    """Check the passed in label if it matches the expected format and raise an
    error if not."""
    if not transaction_label_pattern.match(label):
        raise ValueError(f'Label "{label}" does not follow convention "<resources>.<action>"')

def add_log_entry(user_id, label, project_id=None) -> None:
    """Give a label to the current transaction and time, executed by a
    particular user. This information is recorded only once per transaction,
    and subsequent calls will be ignored silently. Labels are expected to
    follow the pattern <resource>.<action> with <resource> being a plural
    identifier (e.g. treenodes), just like URI endpoints.
    """
    fail_on_wrong_format_label(label)

    cursor = connection.cursor()
    # Only try to insert log record if current transaction is still valid
    if not cursor.db.needs_rollback:
        cursor.execute("""
            INSERT INTO catmaid_transaction_info (user_id, change_type, label,
                project_id)
            VALUES (%s, 'Backend', %s, %s)
            ON CONFLICT DO NOTHING
        """, (user_id, label, project_id))


def record_request_action(label, method=None):
    """Give a label to the current transaction and time, executed by a Django
    user as provided by the wrapped function's request parameter. This
    parameter is first looked up in the function's keyword arguments and if not
    found, the request is expected to be provided as the first argument. If
    <method> is set to a particular HTTP method (i.e. GET or POST), only these
    requests are recorded.
    """
    fail_on_wrong_format_label(label)
    if method and not method.isupper():
        raise ValueError("Method name must be upper case")

    def decorator(f):
        @functools.wraps(f)
        def wrapped_f(*args, **kwargs):
            if 'request' in kwargs:
                request = kwargs['request']
            elif len(args) > 0:
                request = args[0]
            else:
                raise ValueError("Couldn't find request to record action for")

            project_id = kwargs.get('project_id', None)

            result = f(*args, **kwargs)

            user_id = request.user.id
            if not method or request.method == method:
                add_log_entry(user_id, label, project_id)

            return result
        return wrapped_f
    return decorator


def record_action(user_id, label, project_id=None):
    """Give a label to the current transaction and time, executed by a
    particular user.
    """
    fail_on_wrong_format_label(label)
    def decorator(f):
        @functools.wraps(f)
        def wrapped_f(*args, **kwargs):
            result = f(*args, **kwargs)
            add_log_entry(user_id, label, project_id)
            return result
        return wrapped_f
    return decorator


def enable_history_tracking(ignore_missing_fn=False) -> bool:
    """Enable history tracking globally.
    """
    cursor = connection.cursor()
    if ignore_missing_fn:
        cursor.execute("""
            SELECT EXISTS(SELECT 1 FROM pg_class
            WHERE relname='catmaid_history_table');""")
        result = cursor.fetchone()
        if not result[0]:
            # If the function does not exist, return silently if the missing
            # function shouldn't be reported
            return False
    cursor.execute("""
        -- Obtain an advisory lock so that this function works also in a parallel
        -- context.
        SELECT pg_advisory_xact_lock(%(lock_id)s::bigint);
        SELECT enable_history_tracking();
    """, {
        'lock_id':  locks.history_update_event_lock
    })
    return True


def disable_history_tracking(ignore_missing_fn=False) -> bool:
    """Disable history tracking globally.
    """
    cursor = connection.cursor()
    if ignore_missing_fn:
        cursor.execute("""
            SELECT EXISTS(SELECT * FROM pg_proc
            WHERE proname = 'disable_history_tracking');""")
        result = cursor.fetchone()
        if not result[0]:
            # If the function does not exist, return silently if the missing
            # function shouldn't be reported
            return False
    cursor.execute("""
        -- Obtain an advisory lock so that this function works also in a parallel
        -- context.
        SELECT pg_advisory_xact_lock(%(lock_id)s::bigint);
        SELECT disable_history_tracking();
    """, {
        'lock_id':  locks.history_update_event_lock
    })
    return True
