"use client";

import React, { useState, useRef, useEffect } from "react";
import gsap from "gsap";

const SLIDES = [
  {
    id: 1,
    title: "shemoqmedi.space",
    subtitle: "სტუმარმასპინძლობის ციფრული ტრანსფორმაცია",
    content: (
      <div className="flex flex-col items-center justify-center h-full space-y-6 text-center">
        <h1 className="text-6xl font-extrabold tracking-tight text-zinc-900">
          shemoqmedi.space
        </h1>
        <p className="text-2xl text-zinc-600 font-medium">
          გიორგი — დამფუძნებელი და CTO
        </p>
      </div>
    ),
  },
  {
    id: 2,
    title: "პრობლემა",
    subtitle: "რას ვკარგავთ მოლოდინში?",
    content: (
      <div className="grid grid-cols-3 gap-8 h-full items-center">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-zinc-200 flex items-center justify-center text-2xl">
            ⏳
          </div>
          <h3 className="text-xl font-bold text-zinc-900">მოლოდინის რეჟიმი</h3>
          <p className="text-zinc-600">
            კლიენტი კარგავს დროს მიმტანის ან მენიუს მოლოდინში.
          </p>
        </div>
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-zinc-200 flex items-center justify-center text-2xl">
            📄
          </div>
          <h3 className="text-xl font-bold text-zinc-900">სტატიკური PDF</h3>
          <p className="text-zinc-600">
            მოუხერხებელი და არაინტერაქტიული QR მენიუები.
          </p>
        </div>
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-zinc-200 flex items-center justify-center text-2xl">
            📉
          </div>
          <h3 className="text-xl font-bold text-zinc-900">
            დაკარგული შემოსავალი
          </h3>
          <p className="text-zinc-600">
            ლოდინის დრო დაკარგული გაყიდვების შესაძლებლობაა.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 3,
    title: "ჩვენი გამოსავალი",
    subtitle: "ფიზიკურისა და ციფრულის სინთეზი",
    content: (
      <div className="flex flex-row h-full items-center justify-between px-12">
        <div className="flex-1 pr-8 space-y-8">
          <div className="space-y-2">
            <h3 className="text-3xl font-bold text-zinc-900">
              პრემიუმ NFC თეგები
            </h3>
            <p className="text-lg text-zinc-600">
              ჩვენ ვანაცვლებთ სტანდარტულ QR კოდებს ხის ესთეტიკური ფირფიტებით.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="text-3xl font-bold text-zinc-900">
              AI ვირტუალური ასისტენტი
            </h3>
            <p className="text-lg text-zinc-600">
              ტელეფონის დადებით, მომხმარებელს ხვდება პერსონალური ასისტენტი
              პირდაპირ ჩატში.
            </p>
          </div>
        </div>
        <div className="flex-1 flex justify-center">
          <div className="w-64 h-64 bg-zinc-300 rounded-xl flex items-center justify-center shadow-inner border border-zinc-400/50">
            <span className="text-zinc-500 font-medium">
              NFC Plate Image Placeholder
            </span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 4,
    title: "ტექნოლოგია",
    subtitle: "ჭკვიანი და უსაფრთხო არქიტექტურა",
    content: (
      <div className="flex flex-col justify-center h-full space-y-8 pl-12">
        <div className="flex items-start space-x-4">
          <div className="text-2xl mt-1">✨</div>
          <div>
            <h3 className="text-2xl font-bold text-zinc-900">პერსონალიზაცია</h3>
            <p className="text-zinc-600 text-lg">
              მორგებული მომხმარებლის გემოვნებასა და ალერგიებზე.
            </p>
          </div>
        </div>
        <div className="flex items-start space-x-4">
          <div className="text-2xl mt-1">🎯</div>
          <div>
            <h3 className="text-2xl font-bold text-zinc-900">100% სიზუსტე</h3>
            <p className="text-zinc-600 text-lg">
              AI მკაცრად მიყვება მენიუს ბაზას — არცერთი შეცდომა ფასებში.
            </p>
          </div>
        </div>
        <div className="flex items-start space-x-4">
          <div className="text-2xl mt-1">📈</div>
          <div>
            <h3 className="text-2xl font-bold text-zinc-900">
              ავტომატური გაყიდვები
            </h3>
            <p className="text-zinc-600 text-lg">
              ჭკვიანი Upselling ყოველგვარი დაყოვნების გარეშე.
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 5,
    title: "ბაზარი & ტრაქცია",
    subtitle: "პირველი ნაბიჯები და პარტნიორები",
    content: (
      <div className="grid grid-cols-2 gap-12 h-full items-center px-12">
        <div className="space-y-4">
          <h2 className="text-6xl font-black text-zinc-900">10,000+</h2>
          <p className="text-xl text-zinc-600 font-medium">
            კაფე და რესტორანი საქართველოში
          </p>
        </div>
        <div className="space-y-8">
          <div className="bg-zinc-200/50 p-6 rounded-lg border border-zinc-300">
            <h3 className="text-xl font-bold text-zinc-900">
              2 საპილოტე პარტნიორი
            </h3>
            <p className="text-zinc-600">
              მ.შ. დიდი ჩინური რესტორანი და QR მენიუს მქონე კაფის სრული
              ჩანაცვლება.
            </p>
          </div>
          <div className="bg-zinc-200/50 p-6 rounded-lg border border-zinc-300">
            <h3 className="text-xl font-bold text-zinc-900">
              Flitt ინტეგრაცია
            </h3>
            <p className="text-zinc-600">გადახდების სისტემა ბოლო ეტაპზეა.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 6,
    title: "ბიზნეს მოდელი",
    subtitle: "B2B SaaS საწარმოო უპირატესობით",
    content: (
      <div className="flex h-full items-center justify-center space-x-12 px-12">
        <div className="flex-1 bg-white/60 p-8 rounded-xl shadow-sm border border-zinc-200 text-center space-y-4">
          <div className="text-5xl font-bold text-zinc-900">&lt; 1 ₾</div>
          <h3 className="text-lg font-bold text-zinc-700">წარმოების ხარჯი</h3>
          <p className="text-zinc-500 text-sm">
            1 NFC ფირფიტის წარმოება საკუთარი ლაზერული დანადგარით.
          </p>
        </div>
        <div className="text-3xl text-zinc-400">+</div>
        <div className="flex-1 bg-zinc-900 p-8 rounded-xl shadow-lg border border-zinc-800 text-center space-y-4 transform scale-105">
          <div className="text-5xl font-bold text-white">150 ₾</div>
          <h3 className="text-lg font-bold text-zinc-300">თვიური აბონემენტი</h3>
          <p className="text-zinc-400 text-sm">
            ლოკაციაზე + ერთჯერადი Setup მაგიდების მიხედვით.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 7,
    title: "ფინანსები & გუნდი",
    subtitle: "პროგნოზი და საიმედო ზურგი",
    content: (
      <div className="flex flex-col h-full justify-center space-y-12 px-12">
        <div className="flex items-center justify-between border-b border-zinc-300 pb-8">
          <div>
            <p className="text-zinc-500 uppercase tracking-wider text-sm font-bold mb-2">
              წელი 1 მიზანი (100 ლოკაცია)
            </p>
            <h3 className="text-4xl font-black text-zinc-900">~80,000 ₾</h3>
          </div>
          <div className="text-right">
            <p className="text-zinc-500 uppercase tracking-wider text-sm font-bold mb-2">
              წელი 2 მიზანი (ARR)
            </p>
            <h3 className="text-4xl font-black text-zinc-900">180,000 ₾</h3>
          </div>
        </div>
        <div className="space-y-4 text-center">
          <h3 className="text-2xl font-bold text-zinc-900">
            გუნდის გამოცდილება
          </h3>
          <p className="text-zinc-600 text-lg">
            20+ წლიანი სტაჟი იურიდიულ, ფინანსურ და ხის საწარმოო მიმართულებით.
            სრული სანდოობა და ხარისხი.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 8,
    title: "შემდეგი ნაბიჯები",
    subtitle: "შემოგვიერთდით ტესტირებაზე",
    content: (
      <div className="flex flex-col items-center justify-center h-full space-y-8 text-center">
        <h2 className="text-4xl font-bold text-zinc-900 leading-tight">
          ჩვენ არ ვეძებთ დაფინანსებას.
          <br />
          <span className="text-zinc-500">
            გთხოვთ, დაგვაკავშირეთ რესტორნების მფლობელებთან.
          </span>
        </h2>
        <button className="mt-8 px-8 py-4 bg-zinc-900 text-white font-bold rounded-full hover:bg-zinc-800 transition-colors shadow-lg hover:shadow-xl transform hover:-translate-y-1">
          გამოსცადეთ პროტოტიპი ახლავე
        </button>
      </div>
    ),
  },
];

export default function PitchDeck() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const slideRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const nextSlide = () => {
    if (currentIndex < SLIDES.length - 1) {
      animateTransition(currentIndex + 1);
    }
  };

  const prevSlide = () => {
    if (currentIndex > 0) {
      animateTransition(currentIndex - 1);
    }
  };

  const animateTransition = (newIndex: number) => {
    const tl = gsap.timeline({
      onComplete: () => setCurrentIndex(newIndex),
    });

    // Animate content out
    tl.to([titleRef.current, contentRef.current], {
      y: -20,
      opacity: 0,
      duration: 0.3,
      stagger: 0.1,
      ease: "power2.in",
    });

    // Animate content in (happens after state update via useEffect below)
  };

  useEffect(() => {
    // Reveal animation whenever the currentIndex changes
    gsap.fromTo(
      [titleRef.current, contentRef.current],
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: "power3.out" },
    );
  }, [currentIndex]);

  useEffect(() => {
    // Keyboard navigation
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") nextSlide();
      if (e.key === "ArrowLeft") prevSlide();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex]);

  const currentSlide = SLIDES[currentIndex];

  return (
    <div className="flex h-screen w-full flex-col bg-zinc-100 font-sans selection:bg-zinc-300">
      {/* Main Fullscreen Container */}
      <div
        ref={slideRef}
        className="relative flex h-full w-full flex-col p-12 overflow-hidden"
      >
        {/* Header Section */}
        <div
          ref={titleRef}
          className="mb-10 flex flex-col border-b border-zinc-300/80 pb-6"
        >
          <div className="flex items-center justify-between">
            <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900">
              {currentSlide.title}
            </h1>
            <span className="text-lg font-bold text-zinc-400 tabular-nums">
              0{currentSlide.id} / 0{SLIDES.length}
            </span>
          </div>
          {currentSlide.subtitle && (
            <p className="text-lg font-medium text-zinc-500 mt-2">
              {currentSlide.subtitle}
            </p>
          )}
        </div>

        {/* Content Section */}
        <div ref={contentRef} className="flex-grow">
          {currentSlide.content}
        </div>

        {/* Footer */}
        <div className="absolute bottom-8 left-12 flex items-center space-x-2">
          <div className="h-2 w-2 rounded-full bg-zinc-900"></div>
          <span className="text-xs font-black tracking-widest text-zinc-400">
            SHEMOQMEDI.SPACE
          </span>
        </div>

        {/* Navigation Controls */}
        <div className="absolute bottom-8 right-12 flex space-x-4">
          <button
            onClick={prevSlide}
            disabled={currentIndex === 0}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200/80 text-zinc-600 transition-colors hover:bg-zinc-300 disabled:opacity-30"
          >
            ←
          </button>
          <button
            onClick={nextSlide}
            disabled={currentIndex === SLIDES.length - 1}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white transition-colors hover:bg-zinc-800 disabled:opacity-30"
          >
            →
          </button>
        </div>

        {/* Keyboard Hint */}
        <p className="absolute bottom-10 left-1/2 -translate-x-1/2 text-zinc-400 text-sm font-medium">
          Use Arrow Keys to navigate
        </p>
      </div>
    </div>
  );
}
