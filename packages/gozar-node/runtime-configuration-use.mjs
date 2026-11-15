import {createEmbeddingServices,embeddingError} from './embedding-services.mjs';
// Confirmed removal may release an old registry's exact metadata reservation.
// This operation never resolves, imports or deletes credential bytes.
export async function releaseRecordedConfigurationUse(request,runtime){
 const {registryId,...scope}=request;
 const services=registryId&&registryId!==runtime.registryId?createEmbeddingServices({registryId}):runtime.embeddingServices;
 if(typeof services?.releaseConfigurationUse!=='function')throw embeddingError('secret_backend_unavailable');
 await services.releaseConfigurationUse(scope);
}
