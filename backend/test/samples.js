// Realistic sample emails (fictional people and companies' HR) used by the tests.
// Dates are fixed so the expected results never change.
export const SAMPLES = {
  linkedinApplied: {
    id: 's1', date: '2026-10-09T04:30:00.000Z',
    from: 'LinkedIn <jobs-noreply@linkedin.com>',
    subject: 'Rachel, your application was sent to Flipkart',
    text: 'Your application was sent to Flipkart\nData Scientist\nFlipkart · Bengaluru, Karnataka, India (Hybrid)\nApplied on October 9, 2026\nView job: https://www.linkedin.com/comm/jobs/view/4123456789/',
  },
  naukriApplied: {
    id: 's2', date: '2026-10-09T05:45:00.000Z',
    from: 'Naukri <info@naukri.com>',
    subject: 'Application sent: Data Analyst at Swiggy',
    text: 'Hi Rachel,\nYour application has been sent to the recruiter.\nJob title: Data Analyst\nCompany: Swiggy\nLocation: Bengaluru\n',
  },
  hrTest: {
    id: 's3', date: '2026-10-10T06:00:00.000Z',
    from: 'Priya Raman <priya.raman@flipkart.com>',
    subject: 'Flipkart | Round 1 - Online Assessment for Data Scientist',
    text: 'Dear Rachel,\n\nCongratulations! You have been shortlisted for Round 1 (Online Assessment) for the Data Scientist role.\n\n' +
          'Test link: https://www.hackerrank.com/test/abc123xyz\nPlease complete the test by 12th October 2026, 11:59 PM.\nDuration: 90 minutes\n\n' +
          'Regards,\nPriya Raman\nTalent Acquisition | Flipkart\n+91 98450 21734',
  },
  hrInterview: {
    id: 's4', date: '2026-10-11T09:15:00.000Z',
    from: 'Swiggy Careers <careers@swiggy.in>',
    subject: 'Interview scheduled: Technical Round - Data Analyst',
    text: 'Hi Rachel,\n\nYour technical interview with Swiggy is scheduled on Tuesday, 14 October 2026 at 3:30 PM IST.\n' +
          'Mode: Google Meet\nJoin: https://meet.google.com/abc-defg-hij\n\nThanks & Regards\nArjun Mehta\nSenior Recruiter\nMobile: 99001 45528',
  },
  calendarInvite: {
    id: 's5', date: '2026-10-12T08:00:00.000Z',
    from: 'Neha Kulkarni <neha.k@zeptonow.com>',
    subject: 'Invitation: Zepto – HR Round – Rachel @ Thu 16 Oct 2026 11am - 11:30am (IST)',
    text: 'You have been invited to the following event.\nZepto – HR Round – Rachel\nWhen Thursday 16 Oct 2026 ⋅ 11am – 11:30am (India Standard Time - Kolkata)\nJoining info: https://zoom.us/j/9876543210',
    ics: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261016T053000Z\r\nDTEND:20261016T060000Z\r\nSUMMARY:Zepto – HR Round – Rachel\r\n' +
         'ORGANIZER;CN=Neha Kulkarni:mailto:neha.k@zeptonow.com\r\nLOCATION:https://zoom.us/j/9876543210\r\n' +
         'DESCRIPTION:HR discussion for the Business Analyst role.\\nContact: +91 80 4718 2200\r\nEND:VEVENT\r\nEND:VCALENDAR',
  },
  offer: {
    id: 's6', date: '2026-10-20T10:00:00.000Z',
    from: 'Priya Raman <priya.raman@flipkart.com>',
    subject: 'Offer Letter – Data Scientist – Flipkart',
    text: 'Dear Rachel,\nWe are pleased to offer you the position of Data Scientist at Flipkart. Please find your offer letter attached.\nRegards,\nPriya Raman',
  },
  rejection: {
    id: 's7', date: '2026-10-15T12:00:00.000Z',
    from: 'Zepto Talent Team <talent@zeptonow.com>',
    subject: 'Update on your application – Business Analyst',
    text: 'Hi Rachel,\nThank you for your time. Unfortunately, we will not be moving forward with your application for the Business Analyst role.\nZepto Talent Team',
  },
  nextRound: {
    id: 's8', date: '2026-10-13T07:00:00.000Z',
    from: 'Priya Raman <priya.raman@flipkart.com>',
    subject: 'Next steps – Data Scientist',
    text: 'Hi Rachel,\nYou have been selected for the next round. Round 2 - Technical Interview is on 17/10/2026 at 11:00 AM.\n' +
          'Venue: Flipkart, Embassy Tech Village, Outer Ring Road, Bengaluru\nRegards,\nPriya Raman\nTalent Acquisition',
  },
  walkIn: {
    id: 's9', date: '2026-10-09T03:00:00.000Z',
    from: 'Infosys Recruitment <recruitment@infosys.com>',
    subject: 'Walk-in interview invitation – Data Analyst',
    text: 'Dear Candidate,\nYou are invited for a walk-in interview on 20/10/2026 at 10 AM.\nVenue: Infosys Campus, Electronics City, Bengaluru\n' +
          'Contact person: Kavya Rao (080-2852 0261)\nRegards,\nInfosys Recruitment Team',
  },
  workdayApplied: {
    id: 'a1', date: '2026-10-09T06:10:00.000Z',
    from: 'PhonePe <phonepe@myworkday.com>',
    subject: 'Thank you for applying to PhonePe',
    text: 'Dear Rachel,\nThank you for your interest in PhonePe. We have received your application for the position of Senior Data Analyst (JR-10234).\nOur team will review it and get back to you.',
  },
  greenhouseApplied: {
    id: 'a2', date: '2026-10-09T07:00:00.000Z',
    from: 'Razorpay Hiring Team <no-reply@us.greenhouse-mail.io>',
    subject: 'Thank you for applying to Razorpay!',
    text: 'Hi Rachel,\nThanks for applying to the Data Scientist role at Razorpay. Our team will review your application and reach out if there is a fit.',
  },
  leverApplied: {
    id: 'a3', date: '2026-10-09T07:30:00.000Z',
    from: 'Cred <no-reply@hire.lever.co>',
    subject: 'Your application to CRED',
    text: 'Hi Rachel,\nThank you for applying for the Product Analyst position at CRED. We will be in touch.',
  },
  darwinboxRejected: {
    id: 'a4', date: '2026-10-14T05:00:00.000Z',
    from: 'Meesho Careers <noreply@darwinbox.in>',
    subject: 'Update on your application - Business Analyst',
    text: 'Dear Rachel,\nThank you for your interest in Meesho. Unfortunately, we have decided to move forward with other candidates for the Business Analyst role.',
  },
  kekaInterview: {
    id: 'a5', date: '2026-10-15T04:00:00.000Z',
    from: 'Groww Hiring <noreply@keka.com>',
    subject: 'Interview scheduled – Data Analyst',
    text: 'Hi Rachel,\nYour interview for the Data Analyst role at Groww is scheduled on 21 October 2026 at 2:00 PM.\n' +
          'Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc\n\nRegards,\nSneha Iyer\nTalent Acquisition, Groww\n+91 91234 56789',
  },
};
