"""FastAPI composition root. Request authentication precedes payload parsing."""
import json
from pathlib import Path
from uuid import uuid4
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from ..application.platform import PlatformService
from ..application.sessions import SessionService
from ..application.platform_ports import PlatformError
from ..application.overall_analysis import OverallAnalysisError
from ..application.time_contract import UtcClock, utc_text
from ..application.publication import ReportPublicationService
from .settings import ServerSettings, UnavailableRepository
from .supabase_session import SupabaseSessionProvider
from .postgres_repository import PostgresRepository
from .drive_provider import DriveClient, DriveDataProvider, MissingDataProvider
from ..application.forecast_policy import ForecastPolicyService
from .postgres_forecast_repository import PostgresForecastRepository
from .forecast_inputs import DriveForecastInputProvider


def create_app(*,settings=None,repository=None,data=None,sessions=None,clock=None,forecast_repository=None,forecast_inputs=None,entitlements=None):
    settings=settings or ServerSettings.from_environment()
    clock=clock or UtcClock()
    if repository is None: repository=PostgresRepository(settings.database_url) if settings.database_url else UnavailableRepository()
    if data is None:
        if settings.drive_token and settings.drive_input_folder and settings.drive_registry:
            data=DriveDataProvider(DriveClient(settings.drive_token,settings.drive_input_folder,settings.drive_output_folder),settings.drive_registry)
        else:data=MissingDataProvider()
    sessions=sessions or SupabaseSessionProvider(settings.supabase_url,settings.supabase_key)
    auth=SessionService(sessions,repository if entitlements is None else entitlements,clock)
    forecast_store=forecast_repository or (PostgresForecastRepository(repository) if isinstance(repository,PostgresRepository) else None)
    service=PlatformService(repository,data,clock,forecast_repository=forecast_store)
    forecasts=ForecastPolicyService(forecast_store or UnavailableRepository(),forecast_inputs or DriveForecastInputProvider(data),clock)
    service.forecast_service=forecasts
    service.session_service=auth
    app=FastAPI(title='Jungsi Touch Backend',version='1.2.0',docs_url=None,redoc_url=None,openapi_url=None,debug=False)

    @app.middleware('http')
    async def safe_boundary(request,call_next):
        request.state.request_id=uuid4().hex
        try: response=await call_next(request)
        except Exception:
            # Adapter failures never place raw data, connection URLs or tokens in
            # response/log exception text. Detailed private diagnostics are separate.
            response=JSONResponse(status_code=503,content=dict(status='error',error={'code':'backend_dependency_unavailable'},request_id=request.state.request_id))
        response.headers['Cache-Control']='no-store'
        response.headers['X-Request-ID']=request.state.request_id
        response.headers['X-Content-Type-Options']='nosniff'
        return response
    if settings.allowed_origins:
        app.add_middleware(CORSMiddleware,allow_origins=list(settings.allowed_origins),allow_methods=['GET','POST','PUT'],
                           allow_headers=['Authorization','Content-Type','Idempotency-Key'],allow_credentials=False)

    @app.exception_handler(PlatformError)
    @app.exception_handler(OverallAnalysisError)
    async def failure(request,error):
        return JSONResponse(status_code=error.http_status,content=dict(status='error',error={'code':error.code},request_id=request.state.request_id))

    @app.get('/health/live')
    def live():return dict(status='alive',server_timezone='UTC',now=utc_text(clock.now()))

    @app.get('/health/ready')
    def ready():
        missing=settings.missing()
        db={'status':'not_run_configuration_missing'}
        if settings.database_url:
            try:db=repository.probe()
            except PlatformError:db={'status':'unavailable'}
        entitlement_status=None
        if entitlements is not None:
            entitlement_status={'status':'not_run_probe_missing'}
            probe=getattr(entitlements,'probe',None)
            if callable(probe):
                try:
                    result=probe()
                    entitlement_status={'status':'verified' if isinstance(result,dict) and result.get('status')=='verified' else 'failed'}
                except Exception:entitlement_status={'status':'unavailable'}
        configured=not missing and db['status']=='verified' and (entitlement_status is None or entitlement_status['status']=='verified')
        extra={} if entitlement_status is None else {'entitlements':entitlement_status}
        return JSONResponse(status_code=200 if configured else 503,content=dict(status='ready' if configured else 'configuration_pending',
            missing_settings=missing,database=db,auth='configured_not_session_verified' if settings.supabase_url and settings.supabase_key else 'not_configured',
            live_data='not_verified',server_timezone='UTC',**extra))

    def verified_actor(request:Request):
        return auth.actor(request.headers.get('Authorization'))

    def handler(operation):
        async def endpoint(request:Request,actor=Depends(verified_actor)):
            if operation.startswith('forecast.'):
                await run_in_threadpool(forecasts.preauthorize,operation,actor,dict(request.path_params))
            elif operation!='session.read':
                access=await run_in_threadpool(service.access.operation_access,operation,actor,report_id=request.path_params.get('report_id'))
                if not access.allowed:raise PlatformError(access.status,access.http_status)
            body=None
            if request.method in ('POST','PUT'):
                length=request.headers.get('content-length')
                if length and (not length.isdigit() or int(length)>200_000):raise PlatformError('request_too_large',413)
                content=await request.body()
                if len(content)>200_000:raise PlatformError('request_too_large',413)
                try:body=json.loads(content)
                except (ValueError,UnicodeError):raise PlatformError('invalid_json',422)
            pairs=list(request.query_params.multi_items())
            if len({k for k,v in pairs})!=len(pairs):raise PlatformError('duplicate_query_field',422)
            result=await run_in_threadpool(service.execute,operation,actor,body=body,query=dict(pairs),
                params=dict(request.path_params),key=request.headers.get('Idempotency-Key'))
            return JSONResponse(status_code=201 if operation in ('score-profile.create','overall.analyze') else 200,content=result,
                                headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
        return endpoint
    catalog=json.loads(Path(__file__).parents[1].joinpath('application/route_catalog.json').read_text(encoding='utf-8'))
    # Static paths, especially /offerings/search, are registered before parameters.
    operations=sorted(catalog['operations'],key=lambda o:('{' in o['path'],o['path']))
    for operation in operations:
        app.add_api_route(operation['path'],handler(operation['id']),methods=[operation['method']],
                          operation_id=operation['id'].replace('.','_'),openapi_extra={'x-jungsi-operation':operation['id']})
    app.state.forecasts=forecasts
    app.state.platform=service
    writer=DriveClient(settings.drive_token,settings.drive_input_folder,settings.drive_output_folder) if settings.drive_token and settings.drive_output_folder else None
    app.state.publication=ReportPublicationService(service,writer)
    return app


def configured_app():
    return create_app()
