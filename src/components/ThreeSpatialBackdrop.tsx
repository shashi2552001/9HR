import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function ThreeSpatialBackdrop({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let renderer: THREE.WebGLRenderer | null = null;
    let frameId = 0;

    try {
      const width = container.clientWidth || 600;
      const height = container.clientHeight || 600;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
      camera.position.set(0, 0, 7.2);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      container.appendChild(renderer.domElement);

      const group = new THREE.Group();
      scene.add(group);

      const ambient = new THREE.AmbientLight(0xffffff, 0.85);
      scene.add(ambient);
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight.position.set(5, 6, 8);
      scene.add(dirLight);

      // Brand-aligned architectural orbital arcs (Blue #0863E8, Green #079B35, Yellow #F4BD16, Navy #101820)
      const ringDefs = [
        { radius: 2.15, tube: 0.045, color: 0x0863e8, arc: Math.PI * 1.4, rotZ: 0.2, tiltX: 0.35 },
        { radius: 1.72, tube: 0.038, color: 0x079b35, arc: Math.PI * 1.2, rotZ: 2.3, tiltX: -0.45 },
        { radius: 2.55, tube: 0.03, color: 0xf4bd16, arc: Math.PI * 0.9, rotZ: 4.1, tiltX: 0.65 },
      ];

      const rings: THREE.Mesh[] = [];
      for (const def of ringDefs) {
        const geom = new THREE.TorusGeometry(def.radius, def.tube, 24, 96, def.arc);
        const mat = new THREE.MeshStandardMaterial({
          color: def.color,
          roughness: 0.25,
          metalness: 0.45,
          transparent: true,
          opacity: 0.72,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotation.x = def.tiltX;
        mesh.rotation.z = def.rotZ;
        group.add(mesh);
        rings.push(mesh);
      }

      // Subtle central glass icosahedron core
      const coreGeom = new THREE.IcosahedronGeometry(0.95, 1);
      const coreMat = new THREE.MeshPhysicalMaterial({
        color: 0x0863e8,
        roughness: 0.15,
        metalness: 0.1,
        transmission: 0.55,
        transparent: true,
        opacity: 0.35,
        wireframe: true,
      });
      const core = new THREE.Mesh(coreGeom, coreMat);
      group.add(core);

      let targetX = 0;
      let targetY = 0;
      const onPointerMove = (e: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        targetX = ((e.clientX - rect.left) / Math.max(rect.width, 1) - 0.5) * 0.45;
        targetY = ((e.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 0.45;
      };
      window.addEventListener('mousemove', onPointerMove);

      const onResize = () => {
        if (!container || !renderer) return;
        const w = container.clientWidth || 600;
        const h = container.clientHeight || 600;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      const renderScene = () => {
        if (!prefersReduced) {
          rings[0].rotation.z += 0.0025;
          rings[1].rotation.z -= 0.0032;
          rings[2].rotation.y += 0.002;
          core.rotation.y += 0.003;
          core.rotation.x += 0.0015;
          group.rotation.y += (targetX - group.rotation.y) * 0.04;
          group.rotation.x += (targetY - group.rotation.x) * 0.04;
        }
        renderer?.render(scene, camera);
        frameId = requestAnimationFrame(renderScene);
      };
      renderScene();

      return () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('resize', onResize);
        if (renderer?.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        renderer?.dispose();
      };
    } catch {
      return undefined;
    }
  }, []);

  return <div ref={containerRef} className={`pointer-events-none ${className}`} aria-hidden="true" />;
}
