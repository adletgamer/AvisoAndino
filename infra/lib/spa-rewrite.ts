import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type { Construct } from 'constructs';

/**
 * Rutas SPA (/panel, /registro, /c/XXXXXX) -> /index.html SOLO en el comportamiento S3.
 * Sustituye a los errorResponses de la distribución, que también convertían los 403/404
 * de /api/* en 200 + HTML y ocultaban los errores reales del API al cliente.
 */
export function spaRewriteAssociation(scope: Construct, id: string): cloudfront.FunctionAssociation {
  const fn = new cloudfront.Function(scope, id, {
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    comment: 'SPA: rutas sin extension -> /index.html',
    code: cloudfront.FunctionCode.fromInline(
      "function handler(event){var r=event.request;var u=r.uri;" +
      "if(u.indexOf('.',u.lastIndexOf('/'))===-1){r.uri='/index.html';}return r;}",
    ),
  });
  return { function: fn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST };
}
