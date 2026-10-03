"""Explicit server-side private publication, separate from read-only export HTTP."""
from .platform_ports import PlatformError
from .platform import identifier


class ReportPublicationService:
    def __init__(self,platform,writer):self.platform,self.writer=platform,writer
    def publish(self,actor,report_id,request_key):
        snapshot=self.platform.execute('report.export',actor,params={'report_id':report_id})
        identifier(request_key)
        # Immutable snapshot time keeps repeated upload content/hash identical.
        snapshot['generated_at']=snapshot['report']['updated_at']
        if self.writer is None:raise PlatformError('drive_output_not_configured',503)
        return self.writer.append_result(actor.subject_id,'report.snapshot:'+report_id+':'+str(snapshot['snapshot_version']),
                                         request_key,snapshot,self.platform.clock.now())
