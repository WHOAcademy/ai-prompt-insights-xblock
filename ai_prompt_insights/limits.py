"""Shared-cache quotas for AI requests (no new service)."""
from django.conf import settings
from django.core.cache import caches
from django.utils import timezone

class LimitConfigurationError(RuntimeError):
    """Indicate an unsupported or unavailable shared cache configuration."""

def shared_cache():
    """Get the shared Django cache used to coordinate requests."""
    backend = settings.CACHES.get("default", {}).get("BACKEND", "").lower()
    # Per-process caches cannot provide a global limit across LMS workers.
    if "redis" not in backend and "memcached" not in backend:
        raise LimitConfigurationError("Configure a shared Redis/Memcached Django default cache.")
    return caches["default"]

def consume(user, usage, action, limit):
    """Consume one request from a learner's hourly action quota."""
    cache = shared_cache()
    bucket = int(timezone.now().timestamp()) // 3600
    key = f"ai-prompt-insights:quota:{action}:{user}:{usage}:{bucket}"
    try:
        if cache.add(key, 1, timeout=3700):
            return True
        return cache.incr(key) <= limit
    except (ValueError, TypeError, NotImplementedError) as exc:
        raise LimitConfigurationError("Cache backend must support atomic add/incr.") from exc
