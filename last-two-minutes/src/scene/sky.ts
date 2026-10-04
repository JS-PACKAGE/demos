import { Geometry, Mesh, NativeMaterial3D } from 'xyz.js';
import type { Texture, Vector3 } from 'xyz.js';
import { CONTRACT } from '../show/contract.ts';
import { normalize, smooth } from './planet-noise.ts';

export interface SurfaceSky {mesh:Mesh;geometry:Geometry;material:NativeMaterial3D;update(camera:Vector3,enabled:boolean):number}
/** A camera-centred scattering dome lies behind the fleet, not over its silhouettes. */
export function createSurfaceSky(white:Texture):SurfaceSky {
  const source=Geometry.sphere(140,64,32),vertices=source.vertices,positions:number[]=[],normals:number[]=[],uvs:number[]=[];
  const sun=normalize(CONTRACT.visual.lightDirection);
  for(let i=0;i<vertices.length;i+=8){positions.push(vertices[i]!,vertices[i+1]!,vertices[i+2]!);normals.push(...sun);uvs.push(vertices[i+6]!,vertices[i+7]!);}
  const indices=Array.from(source.indices);for(let i=0;i<indices.length;i+=3){const a=indices[i]!;indices[i]=indices[i+2]!;indices[i+2]=a;}
  const geometry=new Geometry({positions,normals,uvs,indices});
  const material=new NativeMaterial3D({texture:white,transparent:true,deformationBounds:0,uniforms:[0],label:'Ground Rayleigh and Mie atmosphere',
    wgsl:`fn xyzDeform(position:vec3f,normal:vec3f,uv:vec2f)->XYZVertex{return XYZVertex(position,normal);}
    fn xyzSurface(world:vec3f,normal:vec3f,uv:vec2f,texel:vec4f)->vec4f{
      let ray=normalize(world-scene.camera.xyz);let up=normalize(scene.camera.xyz);let sun=normalize(scene.lightDirection.xyz);
      let h=max(dot(ray,up),0.0);let mu=dot(ray,sun);let day=smoothstep(-.12,.18,dot(up,sun));
      let air=exp(-h*9.0);let phase=.75*(1.0+mu*mu);let mie=.025/pow(max(.025,1.0+.88*.88-1.76*mu),1.5);
      let dusk=vec3f(.28,.105,.055);let horizon=mix(dusk,vec3f(.34,.46,.56),day);
      let zenith=mix(vec3f(.004,.008,.018),vec3f(.025,.13,.34)*phase,day);
      let disc=smoothstep(.99975,.99993,mu)*day;
      let rgb=mix(zenith,horizon,air)+vec3f(1.0,.8,.53)*(mie*day+disc*3.0);
      let a=mesh.custom[0].x*(.96+.04*day);let lighting=vec3f(max(scene.lightColorAmbient.w,0.0))+scene.lightColorAmbient.rgb*max(scene.lightDirection.w,0.0);
      return vec4f(rgb*a/max(lighting,vec3f(.025)),a);
    }`,
    glsl:`#ifdef XYZ_VERTEX
    XYZVertex xyzDeform(vec3 position,vec3 normal,vec2 uv){return XYZVertex(position,normal);}
    #endif
    #if defined(XYZ_FRAGMENT)
    vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){
      vec3 ray=normalize(world-cameraPosition),up=normalize(cameraPosition),sun=normalize(direction);
      float h=max(dot(ray,up),0.0),mu=dot(ray,sun),day=smoothstep(-.12,.18,dot(up,sun));
      float air=exp(-h*9.0),phase=.75*(1.0+mu*mu),mie=.025/pow(max(.025,1.0+.88*.88-1.76*mu),1.5);
      vec3 horizon=mix(vec3(.28,.105,.055),vec3(.34,.46,.56),day),zenith=mix(vec3(.004,.008,.018),vec3(.025,.13,.34)*phase,day);
      float disc=smoothstep(.99975,.99993,mu)*day,a=xyzUniforms[0].x*(.96+.04*day);
      vec3 rgb=mix(zenith,horizon,air)+vec3(1.0,.8,.53)*(mie*day+disc*3.0);
      vec3 illumination=vec3(max(lighting[1].w,0.0))+lighting[1].rgb*max(lighting[0].w,0.0);
      return vec4(rgb*a/max(illumination,vec3(.025)),a);
    }
    #elif defined(XYZ_SHADOW)
    vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){return texel;}
    #endif`});
  const mesh=new Mesh({geometry,material,castShadow:false,receiveShadow:false});mesh.frustumCulled=false;
  return {mesh,geometry,material,update(camera:Vector3,enabled:boolean){
    const altitude=Math.hypot(camera.x,camera.y,camera.z)-CONTRACT.visual.planetRadius;
    const amount=enabled?1-smooth(.7,2.4,altitude):0;
    mesh.visible=amount>0;mesh.position.set(camera.x,camera.y,camera.z);material.uniforms[0]=amount;
    return amount;
  }};
}
