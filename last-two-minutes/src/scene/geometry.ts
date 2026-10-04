import { Geometry, Matrix4, Quaternion, Vector3 } from 'xyz.js';

/** A genuinely curved, thick crust tile, centred on +Z rather than a flat shard. */
export function crustTile(radius: number, angle: number): Geometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const steps = 5;
  for (let layer = 0; layer < 2; layer++) {
    for (let y = 0; y <= steps; y++) for (let x = 0; x <= steps; x++) {
      const a = (x / steps - .5) * angle, b = (y / steps - .5) * angle;
      const nx = Math.sin(a) * Math.cos(b), ny = Math.sin(b), nz = Math.cos(a) * Math.cos(b);
      const r = radius - layer * .32;
      positions.push(nx * r, ny * r, nz * r - radius);
      normals.push(nx * (layer ? -1 : 1), ny * (layer ? -1 : 1), nz * (layer ? -1 : 1));
      uvs.push(x / steps, y / steps);
    }
  }
  const stride = steps + 1, face = stride * stride;
  for (let y = 0; y < steps; y++) for (let x = 0; x < steps; x++) {
    const a = y * stride + x, b = a + 1, c = a + stride, d = c + 1;
    indices.push(a,b,d,a,d,c,face+a,face+d,face+b,face+a,face+c,face+d);
  }
  for (let i = 0; i < steps; i++) {
    for (const [a,b] of [[i,i+1],[steps*stride+i,steps*stride+i+1],[i*stride,(i+1)*stride],[i*stride+steps,(i+1)*stride+steps]]) {
      indices.push(a,face+a,face+b,a,face+b,b);
    }
  }
  return new Geometry({ positions, normals, uvs, indices });
}

export function fighterGeometry(): Geometry {
  const positions = [0,0,-1.2, -.85,0,.65, 0,.24,.2, .85,0,.65, 0,-.16,.45];
  const indices = [0,2,1,0,3,2,0,1,4,0,4,3,1,2,4,2,3,4];
  const normals: number[] = [];
  for (let i=0;i<positions.length;i+=3) {
    const n = Math.hypot(positions[i],positions[i+1],positions[i+2]);
    normals.push(positions[i]/n,positions[i+1]/n,positions[i+2]/n);
  }
  return new Geometry({positions,normals,uvs:[.5,0,0,1,.5,.6,1,1,.5,1],indices});
}

export const matrix = new Matrix4();
const p = new Vector3(), q = new Quaternion(), s = new Vector3();
const turn = new Matrix4();
export function pose(x:number,y:number,z:number,sx:number,sy:number,sz:number,rx=0,ry=0,rz=0): Matrix4 {
  return matrix.compose(p.set(x,y,z),q.setFromEuler(rx,ry,rz),s.set(sx,sy,sz));
}

/** Orient a local +Z tile to its radial normal, with an outward tumble after release. */
export function radialPose(x:number,y:number,z:number,radius:number,travel:number,tumble:number): Matrix4 {
  const length = Math.hypot(x,y,z); x/=length; y/=length; z/=length;
  const half = Math.sqrt((1+z)/2), denom = Math.max(1e-6,2*half);
  q.set(-y/denom,x/denom,0,half).normalize();
  matrix.compose(p.set(x*(radius+travel),y*(radius+travel),z*(radius+travel)),q,s.set(1,1,1));
  turn.compose(p.set(0,0,0),q.setFromEuler(tumble,tumble*.6,tumble*.3),s.set(1,1,1));
  return matrix.multiply(turn);
}
