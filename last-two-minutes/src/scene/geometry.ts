import { Matrix4, Quaternion, Vector3 } from 'xyz.js';

const matrix = new Matrix4();
const p = new Vector3(), q = new Quaternion(), s = new Vector3();
/** Reusable instance transform; copy it into an InstancedMesh before the next call. */
export function pose(x:number,y:number,z:number,sx:number,sy:number,sz:number,rx=0,ry=0,rz=0): Matrix4 {
  return matrix.compose(p.set(x,y,z),q.setFromEuler(rx,ry,rz),s.set(sx,sy,sz));
}
