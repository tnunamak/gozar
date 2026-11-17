import {createEmbeddingServices,embeddingError} from './embedding-services.mjs';
// Confirmed removal may release an old registry's exact metadata reservation.
// This operation never resolves, imports or deletes credential bytes.
export async function releaseRecordedConfigurationUse(request,runtime={}){
 const {registryId,...scope}=request;
 if(registryId!==undefined&&(typeof registryId!=='string'||!registryId.trim()))throw embeddingError('invalid_input');
 const matching=registryId===undefined||registryId===runtime.registryId;
 const services=matching&&runtime.embeddingServices?runtime.embeddingServices:
  registryId?createEmbeddingServices({registryId}):null;
 if(typeof services?.releaseConfigurationUse!=='function')throw embeddingError('secret_backend_unavailable');
 await services.releaseConfigurationUse(scope);
}
