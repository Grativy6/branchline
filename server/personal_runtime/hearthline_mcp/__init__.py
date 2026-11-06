"""Public Hearthline toolkit runtime.

The package contains model-neutral, bounded records and continuity helpers.
It does not load Hearthline lore, private history, or a model by default.
"""

__version__ = "0.3.0"

def create_server(*args, **kwargs):
    """Load the full toolkit only when requested; narrow services stay independent."""
    from .server import create_server as factory
    return factory(*args, **kwargs)

__all__ = ["__version__", "create_server"]
