"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { ImagePlus, X } from "lucide-react";
import * as THREE from "three";
import { preparePhoto } from "./photo";

/** The leaf the photo pocket is printed on, identified by its artwork. */
export const PHOTO_PAGE_TEXTURE = "page-6";

/**
 * The same leaf's material name. A custom book swaps the artwork above for the
 * reader's own upload, but material names come from the model and never change.
 */
export const PHOTO_PAGE_MATERIAL = "6";

/** The bone that swings the white card open to uncover the pocket. */
export const PHOTO_CARD_BONE = "lid";

/**
 * Camera distance, in world units, at which the overlaid controls render at
 * their natural pixel size; nearer or further they scale in proportion.
 *
 * The camera is pulled back to fit the book into the viewport, so it sits
 * around 4.4 units away on a desktop but nearly 12 on a phone, where the
 * frame is much narrower. Fixed-pixel HTML therefore keeps its size while the
 * book shrinks by about a third, which is what made the button swamp the
 * pocket. Matching this to the desktop distance leaves that view as it was and
 * scales the controls down in step with the book everywhere narrower.
 */
const HTML_DISTANCE = 4.4;

/**
 * The pocket rectangle, in the local space of the page-6 mesh. `right` and
 * `down` follow the page artwork, so a photo laid along them reads upright.
 */
export type PhotoFrame = {
  centre: THREE.Vector3;
  right: THREE.Vector3;
  down: THREE.Vector3;
  normal: THREE.Vector3;
  width: number;
  height: number;
};

/**
 * Gap between the photo and the page, in model units (metres). Enough to
 * clear the raised lip of the pocket's slot, which otherwise cuts a grey arc
 * across the top of the photo.
 */
const LIFT = 0.0012;

/** Width of the white print border around the photo. */
const BORDER = 0.0022;

/**
 * Measures the pocket from the card that covers it. The caller parks the
 * book where the card lies flat over the pocket; a least-squares fit of the
 * card's skinned vertices against their page UVs then yields the pocket's
 * position and the direction the artwork runs across it.
 */
export function measurePhotoFrame(mesh: THREE.SkinnedMesh): PhotoFrame | null {
  const card = mesh.skeleton.bones.findIndex((bone) => bone.name === PHOTO_CARD_BONE);
  const { geometry } = mesh;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute("uv");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  if (card < 0 || !position || !uv || !skinIndex || !skinWeight) return null;

  // Normal equations for: position = origin + u * alongU + v * alongV.
  const ata = new Array<number>(9).fill(0);
  const atb = [0, 1, 2].map(() => new Array<number>(3).fill(0));
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let samples = 0;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    let onCard = false;
    for (let k = 0; k < 4; k++) {
      if (skinIndex.getComponent(i, k) === card && skinWeight.getComponent(i, k) > 0.99) onCard = true;
    }
    if (!onCard) continue;

    const u = uv.getX(i);
    const v = uv.getY(i);
    vertex.fromBufferAttribute(position, i);
    mesh.applyBoneTransform(i, vertex);

    const row = [u, v, 1];
    const coords = [vertex.x, vertex.y, vertex.z];
    for (let a = 0; a < 3; a++) {
      for (let c = 0; c < 3; c++) ata[a * 3 + c] += row[a] * row[c];
      for (let axis = 0; axis < 3; axis++) atb[axis][a] += row[a] * coords[axis];
    }

    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
    samples++;
  }
  if (samples < 3) return null;

  const inverse = new THREE.Matrix3().set(...(ata as [number, number, number, number, number, number, number, number, number]));
  if (Math.abs(inverse.determinant()) < 1e-12) return null;
  inverse.invert();

  // Per axis: [d/du, d/dv, constant].
  const [x, y, z] = atb.map((b) => new THREE.Vector3(b[0], b[1], b[2]).applyMatrix3(inverse));
  const alongU = new THREE.Vector3(x.x, y.x, z.x);
  const alongV = new THREE.Vector3(x.y, y.y, z.y);
  const origin = new THREE.Vector3(x.z, y.z, z.z);

  // Fill the pocket, leaving a slim margin and a little more at the top for its thumb notch.
  const du = uMax - uMin;
  const dv = vMax - vMin;
  const u0 = uMin + du * 0.035;
  const u1 = uMax - du * 0.035;
  const v0 = vMin + dv * 0.1;
  const v1 = vMax - dv * 0.035;

  const right = alongU.clone().normalize();
  const down = alongV.clone().normalize();

  return {
    centre: origin
      .clone()
      .addScaledVector(alongU, (u0 + u1) / 2)
      .addScaledVector(alongV, (v0 + v1) / 2),
    right,
    down,
    // With image axes (right, down), the side facing the reader is down x right.
    normal: new THREE.Vector3().crossVectors(down, right).normalize(),
    width: alongU.length() * (u1 - u0),
    height: alongV.length() * (v1 - v0),
  };
}

/** A quad over the frame, facing the reader, with image-style UVs (0,0 = top left). */
function frameGeometry(frame: PhotoFrame, grow: number, lift: number) {
  const halfWidth = frame.width / 2 + grow;
  const halfHeight = frame.height / 2 + grow;
  const corner = (across: number, downwards: number) =>
    frame.centre
      .clone()
      .addScaledVector(frame.right, across * halfWidth)
      .addScaledVector(frame.down, downwards * halfHeight)
      .addScaledVector(frame.normal, lift);

  const points = [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, 1)];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points.flatMap((point) => point.toArray()), 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

/** Crops the texture like CSS `object-fit: cover`, so the photo is never stretched. */
function coverFit(texture: THREE.Texture, imageAspect: number, frameAspect: number) {
  if (imageAspect > frameAspect) {
    texture.repeat.set(frameAspect / imageAspect, 1);
    texture.offset.set((1 - texture.repeat.x) / 2, 0);
  } else {
    texture.repeat.set(1, imageAspect / frameAspect);
    texture.offset.set(0, (1 - texture.repeat.y) / 2);
  }
}

export default function PhotoSlot({
  frame,
  photo,
  showControls,
  isRevealed,
  onChange,
}: {
  frame: PhotoFrame;
  photo: string | null;
  /** True once the book has settled on the last page. */
  showControls: boolean;
  /** Whether the card has swung far enough open to uncover the pocket. */
  isRevealed: () => boolean;
  /** Stores or clears the photo; returns false if it could not be kept. */
  onChange: (photo: string | null) => boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);

  const geometries = useMemo(
    () => ({
      photo: frameGeometry(frame, 0, LIFT),
      border: frameGeometry(frame, BORDER, LIFT * 0.5),
    }),
    [frame],
  );
  useEffect(
    () => () => {
      geometries.photo.dispose();
      geometries.border.dispose();
    },
    [geometries],
  );

  const borderMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#fdfbf6",
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [],
  );
  useEffect(() => () => borderMaterial.dispose(), [borderMaterial]);

  const photoMaterial = useMemo(() => {
    if (!photo) return null;

    const image = new Image();
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // matches the quad's top-left UV origin
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.85, // a matte print, so reflections do not wash the photo out
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.visible = false; // hidden until the image has decoded

    image.onload = () => {
      coverFit(texture, image.width / image.height, frame.width / frame.height);
      texture.needsUpdate = true;
      material.visible = true;
    };
    image.src = photo;
    return material;
  }, [frame, gl, photo]);
  useEffect(
    () => () => {
      photoMaterial?.map?.dispose();
      photoMaterial?.dispose();
    },
    [photoMaterial],
  );

  // Until the card lifts, it lies over the pocket; keep the photo out of it.
  useFrame(() => {
    if (group.current) group.current.visible = isRevealed();
  });

  const centre = useMemo(
    () => frame.centre.clone().addScaledVector(frame.normal, LIFT),
    [frame],
  );
  const corner = useMemo(
    () =>
      centre
        .clone()
        .addScaledVector(frame.right, frame.width / 2)
        .addScaledVector(frame.down, -frame.height / 2),
    [centre, frame],
  );

  // Dev-only: where the photo sits on screen, so scripts can click it.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const scope = window as unknown as Record<string, unknown>;
    scope.__bookPhotoPoint = () => {
      if (!group.current) return null;
      const rect = gl.domElement.getBoundingClientRect();
      const point = centre.clone().applyMatrix4(group.current.matrixWorld).project(camera);
      return {
        x: rect.left + ((point.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - point.y) / 2) * rect.height,
      };
    };
    return () => {
      delete scope.__bookPhotoPoint;
    };
  }, [camera, centre, gl]);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be picked again later
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const dataUrl = await preparePhoto(file);
      if (!onChange(dataUrl)) setError("This photo is too big to keep. Please try a smaller one.");
    } catch {
      setError("That picture could not be opened. Please try a JPG or PNG.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    setSelected(false);
    document.body.style.cursor = "";
    onChange(null);
  };

  return (
    <group ref={group}>
      {photoMaterial && (
        <>
          <mesh geometry={geometries.border} material={borderMaterial} userData={{ keepsake: true }} />
          <mesh
            geometry={geometries.photo}
            material={photoMaterial}
            userData={{ keepsake: true }}
            onClick={(event: ThreeEvent<MouseEvent>) => {
              if (!showControls || !isRevealed()) return;
              event.stopPropagation();
              setSelected((current) => !current);
            }}
            onPointerMissed={() => setSelected(false)}
            onPointerOver={() => {
              if (showControls) document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
            }}
          />
        </>
      )}

      {/* `distanceFactor` ties the overlay to the scene's perspective, so it
          scales with the book instead of staying at fixed screen pixels --
          otherwise it swamps the pocket on a narrow phone viewport. */}
      {showControls && !photo && (
        <Html center position={centre} zIndexRange={[15, 0]} distanceFactor={HTML_DISTANCE}>
          <div className="flex w-max max-w-[16rem] flex-col items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="cursor-pointer flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#2c6350] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_6px_18px_rgba(44,99,80,0.35)] transition hover:bg-[#23513f] active:scale-95 disabled:opacity-60 sm:gap-2 sm:px-5 sm:py-3 sm:text-base sm:shadow-[0_10px_28px_rgba(44,99,80,0.35)]"
            >
              <ImagePlus aria-hidden className="h-3.5 w-3.5 sm:h-5 sm:w-5" strokeWidth={2.2} />
              {busy ? "Adding photo…" : "Add your photo"}
            </button>
            {error && (
              <p className="rounded-lg bg-[#fdf8ee] px-2 py-1.5 text-center text-[10px] font-medium leading-snug text-[#9b3b2a] shadow-md sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs">
                {error}
              </p>
            )}
            <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
          </div>
        </Html>
      )}

      {showControls && photo && selected && (
        <Html center position={corner} zIndexRange={[15, 0]} distanceFactor={HTML_DISTANCE}>
          <button
            type="button"
            onClick={remove}
            aria-label="Remove photo"
            title="Remove photo"
            className="cursor-pointer flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#c0392b] p-1.5 text-xs font-semibold text-white shadow-[0_5px_14px_rgba(192,57,43,0.35)] transition hover:bg-[#a93226] active:scale-95 sm:p-2 sm:text-sm sm:shadow-[0_8px_22px_rgba(192,57,43,0.35)]"
          >
            <X aria-hidden className="h-3 w-3 sm:h-4 sm:w-4" strokeWidth={2.8} />
          </button>
        </Html>
      )}
    </group>
  );
}
