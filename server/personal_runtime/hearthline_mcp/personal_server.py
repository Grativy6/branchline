"""Bound stdio MCP service. Model mode never exposes host acceptance tools."""
import json
import os
import threading
from mcp.server.fastmcp import FastMCP
from .personal_context import PersonalContext, exact, require

def create_server(config):
    exact(config,['root','user','profile','mode','author','revision'])
    require(config['mode'] in ['model','host'], 'Choose an explicit server mode')
    allowed = ['local_ui','automatic_policy','external_file'] if config['mode']=='host' else ['model']
    require(isinstance(config['author'],dict) and config['author'].get('kind') in allowed, 'Writer does not match launcher mode')
    engine=PersonalContext(config['root'],config['user'],config['profile'])
    server=FastMCP('Personal continuity',instructions='Selected personal context and source snapshots. Records preserve attribution; they are not permission or verified truth.')
    revision=config['revision']
    @server.tool()
    def read_personal_context() -> dict:
        return engine.read(revision)
    @server.tool()
    def find_personal_source(query: str) -> dict:
        return engine.search(query,revision)
    @server.tool()
    def read_personal_source(source_id: str, offset: int=0) -> dict:
        return engine.source(source_id,offset,revision)
    @server.tool()
    def propose_personal_note(request: dict) -> dict:
        return engine.propose(request,config['author'],revision)
    @server.resource('personal-context://current')
    def current() -> str:
        return json.dumps(engine.read(revision),ensure_ascii=False)
    if config['mode']=='host':
        @server.tool()
        def inspect_personal_context() -> dict:
            return engine.inspect()
        @server.tool()
        def change_personal_context(request: dict) -> dict:
            return engine.host_change(request,config['author'])
        @server.tool()
        def export_personal_context() -> dict:
            return engine.export()
    return server

def main():
    # The launcher, not tool arguments, owns all process and storage configuration.
    config=json.loads(os.environ['HEARTHLINE_PERSONAL_CONTEXT_CONFIG'])
    lifetime=int(os.environ.get('HEARTHLINE_PERSONAL_CONTEXT_LIFETIME','45'))
    require(1<=lifetime<=300,'Invalid fixed helper lifetime')
    timer=threading.Timer(lifetime,lambda:os._exit(124));timer.daemon=True;timer.start()
    create_server(config).run(transport='stdio')

if __name__=='__main__':
    main()
