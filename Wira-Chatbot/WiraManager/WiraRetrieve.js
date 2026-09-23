const axios = require("axios");
const embedder = require("@wira/shared/Utility/embedding");
const vectorDb = require("@wira/shared/database/pgFunctions");
const jobsDb = require("@wira/shared/database/relevantSearchDb");

const WiraUtility = require("./WiraUtility");
const WiraDatabase = require("./WiraDatabase");
const WiraQueue = require("./WiraQueue");
const WiraSession = require("./WiraSession");

class WiraRetrieve {
  constructor(database, utility, queue, session) {
    this.utility = utility ?? new WiraUtility();
    this.database = database ?? new WiraDatabase();
    this.queue = queue ?? new WiraQueue();
    this.session = session ?? new WiraSession();
  }

  //Fetch semantically relevant website chunks for a query string.
  async fetchRelevantChunks(query) {
    try {
      let embedding = await embedder.getEmbedding(query);

      if (!embedding) {
        return {
          statusCode: 500,
          success: false,
          message: "Failed to generate embedding.",
          data: null,
        };
      }

      const results = await vectorDb.searchCompanyData(embedding, 5);

      return {
        statusCode: 200,
        success: true,
        message: "Relevant chunks fetched successfully.",
        data: results,
      };
    } catch (error) {
      console.error("Error fetching relevant chunks: ", error);
      return {
        statusCode: 500,
        success: false,
        message: "Error fetching relevant chunks.",
        data: null,
      };
    }
  }

  //Fetch semantically relevent past conversations throughout different platforms.
  async fetchRelevantPast(
    phone,
    text,
    excludeIds = [],
    platform,
    threshold = 30,
    limit = 5,
  ) {
    try {
      const results = await this.database.semanticSearchAllMessages(
        phone,
        platform,
        text,
        threshold,
        limit,
        excludeIds,
      );

      return {
        statusCode: 200,
        success: true,
        message: "Semantic message search completed successfully.",
        data: results ?? [],
      };
    } catch (error) {
      console.error("Error occured in semantic message search: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured in semantic message search.",
        data: null,
      };
    }
  }

  //Fetch semantically relevent past files chunks.
  async fetchRelevantFiles(
    phone,
    text,
    excludeFileNames = [],
    includeFileNames = [],
    threshold = 30,
    limit = 5,
  ) {
    try {
      const results = await this.database.semanticSearchAllFiles(
        phone,
        text,
        threshold,
        limit,
        excludeFileNames,
        includeFileNames,
      );

      return {
        statusCode: 200,
        success: true,
        message: "Semantic file search completed successfully.",
        data: results ?? [],
      };
    } catch (error) {
      console.error("Error occured in semantic file search: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured in semantic file search.",
        data: null,
      };
    }
  }

  //Fetching specific files full content.
  async fetchCandidate(phone) {
    function parseExperienceData(data) {
      if (data) {
        const parsedData = JSON.parse(data);
        return parsedData.map((exp) => ({
          companyName: exp.company_name,
          designation: exp.designation,
          currentSalary: parseFloat(exp.current_salary) || 0,
          totalExperience: parseFloat(exp.total_experience) || 0,
          isCurrentCompany: exp.is_current_company,
          startDate: exp.start_date,
          endDate: exp.end_date,
        }));
      } else {
        return [];
      }
    }

    function parseEducationData(data) {
      if (data) {
        const parsedData = JSON.parse(data);
        return parsedData.map((edu) => ({
          educationType: edu.education_type,
          educationName: edu.education_name,
          graduationYear: parseInt(edu.education_year) || null,
          university: edu.university,
          startDate: edu.start_date,
          endDate: edu.end_date,
        }));
      } else {
        return [];
      }
    }

    try {
      const [apiResponse, wiraCandidate] = await Promise.all([
        axios.post(
          `https://white-force.com/plus/api/get-profile-data?mobile=${phone}`,
          {},
          {
            headers: {
              "x-api-key": process.env.WIRA_API_KEY,
            },
          },
        ),
        this.database.db.fetchWiraCandidates({ phone }).catch(() => null),
      ]);

      const atsResume = wiraCandidate?.rows?.[0]?.atsResume ?? null;

      if (apiResponse.data.status) {
        const d = apiResponse.data.data;
        const data = {
          candidateId: d.id ?? null,
          resume: d.resume_file ?? null,
          atsResume: atsResume ?? null,
          resumeParserJson: d.resume_parser_json ?? null,
          fullName: d.name ?? null,
          phone: d.mobile ?? phone,
          email: d.email ?? null,
          preferredLocation: d.preferred_location ?? null,
          noticePeriod: d.notice_period ?? null,
          industry: d.industry ?? null,
          expectedSalary: d.expected_salary ?? null,
          experience: d.experience ?? null,
          totalExperience: this.utility.formatExperience(
            d.total_experience ?? null,
          ),
          experienceData: d.experience_details
            ? parseExperienceData(d.experience_details)
            : null,
          educationData: d.education_details
            ? parseEducationData(d.education_details)
            : null,
          gender: d.gender ?? null,
          maritalStatus: d.marital_status ?? null,
          relocate: d.is_relocate ?? null,
          language: d.languages
            ? d.languages.split(",").map((l) => l.trim())
            : null,
          communication: d.communication ?? null,
          dateOfBirth: d.date_of_birth ?? null,
          skills: d.skills ? d.skills.split(",").map((s) => s.trim()) : [],
          country: d.country ?? null,
          state: d.state ?? null,
          city: d.city ?? null,
          address: d.address ?? null,
          postelCode: d.pin_code ?? null,
        };

        console.log("Data: ", data);

        return {
          statusCode: 200,
          success: true,
          message: apiResponse.data.message,
          data: data,
        };
      } else {
        return {
          statusCode: 400,
          success: false,
          message: apiResponse.data.message,
          data: null,
        };
      }
    } catch (error) {
      console.error("Error occured fetching candidate data: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured fetching candidate data.",
        data: null,
      };
    }
  }

  // //Fetching Candidates data using phone number.
  // async fetchCandidate(phone)
  // {
  //     function parseExperienceData(data)
  //     {
  //         if(data)
  //         {
  //             const parsedData = JSON.parse(data);

  //             return parsedData.map(exp => ({
  //                 companyName: exp.company_name,
  //                 designation: exp.designation,
  //                 currentSalary: parseFloat(exp.current_salary) || 0,
  //                 totalExperience: parseFloat(exp.total_experience) || 0,
  //                 isCurrentCompany: exp.is_current_company,
  //                 startDate: exp.start_date,
  //                 endDate: exp.end_date
  //             }));
  //         }
  //         else
  //         {
  //             return [];
  //         }
  //     }

  //     function parseEducationData(data)
  //     {
  //         if(data)
  //         {
  //             const parsedData = JSON.parse(data);

  //             return parsedData.map(edu => ({
  //                 educationType: edu.education_type,
  //                 educationName: edu.education_name,
  //                 graduationYear: parseInt(edu.education_year) || null,
  //                 university: edu.university,
  //                 startDate: edu.start_date,
  //                 endDate: edu.end_date
  //             }));
  //         }
  //         else
  //         {
  //             return [];
  //         }
  //     }

  //     try
  //     {
  //         const response = await axios.post(`https://white-force.com/plus/api/get-profile-data?mobile=${phone}`, {},
  //         {
  //             headers: {
  //                 "x-api-key": process.env.WIRA_API_KEY,
  //             },
  //         });

  //         if(response.data.status)
  //         {
  //             const d = response.data.data;
  //             const data =  {
  //                 candidateId: d.id ?? null,
  //                 resume: d.resume_file ?? null,
  //                 resumeParserJson: d.resume_parser_json ?? null,
  //                 fullName: d.name ?? null,
  //                 phone: d.mobile ?? phone,
  //                 email: d.email ?? null,
  //                 preferredLocation: d.preferred_location ?? null,
  //                 noticePeriod: d.notice_period ?? null,
  //                 industry: d.industry ?? null,
  //                 expectedSalary: d.expected_salary ?? null,
  //                 experience: d.experience ?? null,
  //                 totalExperience: this.utility.formatExperience(d.total_experience ?? null),
  //                 experienceData: d.experience_details ? parseExperienceData(d.experience_details) : null,
  //                 educationData: d.education_details ? parseEducationData(d.education_details) : null,
  //                 gender: d.gender ?? null,
  //                 maritalStatus: d.marital_status ?? null,
  //                 relocate: d.is_relocate ?? null,
  //                 language: d.languages ? d.languages.split(",").map(l => l.trim()) : null,
  //                 communication: d.communication ?? null,
  //                 dateOfBirth: d.date_of_birth ?? null,
  //                 skills: d.skills ? d.skills.split(",").map(s => s.trim()) : [],
  //                 country: d.country ?? null,
  //                 state: d.state ?? null,
  //                 city: d.city ?? null,
  //                 address: d.address ?? null,
  //                 postelCode: d.pin_code ?? null,
  //             }

  //             console.log("Data: ", data);

  //             return {
  //                 statusCode: 200,
  //                 success: true,
  //                 message: response.data.message,
  //                 data: data
  //             };
  //         }
  //         else
  //         {
  //             return {
  //                 statusCode: 400,
  //                 success: false,
  //                 message: response.data.message,
  //                 data: null
  //             };
  //         }
  //     }
  //     catch(error)
  //     {
  //         console.error("Error occured fetching candidate data: ", error);
  //         return {
  //             statusCode: 500,
  //             success: false,
  //             message: "Error occured fetching candidate data.",
  //             data: null
  //         };
  //     }
  // }

  //Fetch Job Full Data.
  async fetchJobs(jobIds, phone = null) {
    try {
      const response = await axios.post(
        `https://white-force.com/plus/api/jobs-by-ids`,
        { job_id: jobIds },
        {
          headers: {
            "x-api-key": process.env.WIRA_API_KEY,
          },
        },
      );

      if (response.data.status) {
        if (response.data.data && response.data.data.length > 0) {
          const jobs = response.data.data.map((item, index) => {
            return {
              id: item.id,
              clientId: item.client_id,
              clientName: item.clientname,
              positionName: item.position_name,
              openings: item.openings,
              country: item.countries,
              countryCode: item.country_code,
              state: item.states,
              city: item.city,
              location: item.locations,
              jobAddress: item.job_address,
              postalCode: item.postal_code,
              jobDescription: item.job_description,
              skillSet: item.skill_set
                ? item.skill_set.split(",").map((s) => s.trim())
                : [],
              minYearExp: item.min_year_exp,
              maxYearExp: item.max_year_exp,
              eduQualification: item.edu_qualification,
              specification: item.specification
                ? item.specification
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
              salaryType: item.salary_type,
              payType: item.pay_type,
              minSalary: item.min_salary,
              maxSalary: item.max_salary,
              jobType: item.job_type,
              isRemoteWork: !!item.is_remote_work,
              industry: item.industry,
              gender: item.gender,
              contactPersonName: item.contact_person_name,
              personContact: item.person_contact,
              personEmail: item.person_email,
              jdJson: item.jd_json ? JSON.parse(item.jd_json) : null,
            };
          });

          if (phone) {
            const session = await this.session.getSession(phone);
            const wishlistIds =
              session && session.wishlistIds.length > 0
                ? session.wishlistIds
                : null;
            const appliedJobIds =
              session && session.appliedJobIds.length > 0
                ? session.appliedJobIds
                : null;

            jobs.forEach((job) => {
              if (wishlistIds !== null) {
                job.isWishlisted = wishlistIds.includes(job.id);
              }

              if (appliedJobIds !== null) {
                job.isApplied = appliedJobIds.includes(job.id);
              }
            });
          }

          return {
            statusCode: 200,
            success: true,
            message: "Jobs retrieved successfully.",
            data: {
              jobs: jobs,
            },
          };
        } else {
          return {
            statusCode: 404,
            success: false,
            message: "Jobs not found.",
            data: null,
          };
        }
      } else {
        return {
          statusCode: 500,
          success: false,
          message: "Error occured fetching jobs.",
          data: null,
        };
      }
    } catch (error) {
      console.error("Error occured fetching jobs: ", error);
      return {
        statusCode: 500,
        success: false,
        message: "Error occured fetching jobs.",
        data: null,
      };
    }
  }

  //Fetch semantically relevant jobs by embedding a query string, with optional hard filters and jobIds scope.
  async fetchSemanticJobs(
    query,
    filters = {},
    jobIds = [],
    perPage = 10,
    pageNo = 1,
    phone = null,
  ) {
    try {
      let embedding = await embedder.getEmbedding(query);

      if (!embedding) {
        return {
          statusCode: 500,
          success: false,
          message: "Failed to generate embedding.",
          data: null,
        };
      }

      const offset = (pageNo - 1) * perPage;
      const result = await jobsDb.searchJobs(
        embedding,
        perPage,
        offset,
        30,
        filters,
        jobIds,
      );

      if (result.rows.length === 0) {
        return {
          statusCode: 404,
          success: false,
          message: "No matching jobs found.",
          data: null,
        };
      }

      const jobIdResults = result.rows.map((j) => j.id);
      const jobData = await this.fetchJobs(jobIdResults, phone);

      if (!jobData.success) {
        return jobData;
      }

      const similarityMap = new Map(
        result.rows.map((j) => [
          j.id,
          { similarity: j.similarity, rawSimilarity: j.rawSimilarity },
        ]),
      );

      const jobs = jobData.data.jobs.map((item) => {
        const sim = similarityMap.get(item.id) || {};

        return {
          id: item.id,
          clientId: item.clientId,
          clientName: item.clientName,
          positionName: item.positionName,
          openings: item.openings,
          country: item.country,
          countryCode: item.countryCode,
          state: item.state,
          city: item.city,
          location: item.location,
          jobAddress: item.jobAddress,
          postalCode: item.postalCode,
          jobDescription: item.jobDescription,
          skillSet: item.skillSet,
          minYearExp: item.minYearExp,
          maxYearExp: item.maxYearExp,
          eduQualification: item.eduQualification,
          specification: item.specification,
          salaryType: item.salaryType,
          payType: item.payType,
          minSalary: item.minSalary,
          maxSalary: item.maxSalary,
          jobType: item.jobType,
          isRemoteWork: item.isRemoteWork,
          industry: item.industry,
          gender: item.gender,
          contactPersonName: item.contactPersonName,
          personContact: item.personContact,
          personEmail: item.personEmail,
          jdJson: item.jdJson,
          similarity: sim.similarity || null,
          rawSimilarity: sim.rawSimilarity || null,
        };
      });

      const lastPage = Math.ceil(result.total / perPage);

      return {
        statusCode: 200,
        success: true,
        message: "Semantic job search completed successfully.",
        data: {
          jobs,
          pagination: {
            currentPage: pageNo,
            lastPage,
            perPage,
            total: result.total,
          },
        },
      };
    } catch (error) {
      console.error("❌ Error fetching semantic jobs: ", error);
      return {
        statusCode: 500,
        success: false,
        message: "Error fetching semantic jobs.",
        data: null,
      };
    }
  }

  //Fetch summarized Wishlisted jobs.
  async fetchWishlistedJobs(phone, perPage = 10, pageNo = 1, wishlistIds = []) {
    try {
      const requests = [];

      requests.push(
        axios.post(
          `https://white-force.com/plus/api/get-candidate-wishlist?mobile=${phone}&per_page=${perPage}&page=${pageNo}`,
          {},
          {
            headers: {
              "x-api-key": process.env.WIRA_API_KEY,
            },
          },
        ),
      );

      if (wishlistIds && wishlistIds.length > 0) {
        const start = (pageNo - 1) * perPage;
        const pagedIds = wishlistIds.slice(start, start + perPage);

        if (pagedIds.length > 0) {
          requests.push(
            this.fetchJobs(pagedIds, phone).then((result) => {
              if (result.success) {
                return {
                  _source: "fetchJobs",
                  ...result,
                };
              }

              return Promise.reject("fetchJobs failed");
            }),
          );
        }
      }

      const winner = await Promise.any(
        requests.map((r) =>
          Promise.resolve(r).then((res) => {
            if (res && res._source === "fetchJobs") {
              return res;
            }

            if (res && res.data && res.data.status) {
              return {
                _source: "api",
                ...res,
              };
            }

            return Promise.reject("Request failed or invalid");
          }),
        ),
      );

      if (winner._source === "fetchJobs") {
        const jobs = winner.data.jobs;

        const session = await this.session.getSession(phone);
        const appliedJobIds =
          session && session.appliedJobIds.length > 0
            ? session.appliedJobIds
            : null;

        jobs.forEach((job) => {
          job.isWishlisted = true;

          if (appliedJobIds !== null) {
            job.isApplied = appliedJobIds.includes(job.id);
          }
        });

        return {
          statusCode: 200,
          success: true,
          message: "Wishlisted jobs retrieved successfully.",
          data: {
            jobs: jobs,
            pagination: {
              currentPage: pageNo,
              lastPage: Math.ceil(wishlistIds.length / perPage),
              perPage: perPage,
              total: wishlistIds.length,
            },
          },
        };
      }

      const response = winner;

      if (
        response.data &&
        response.data.data &&
        response.data.data.length > 0
      ) {
        const jobs = response.data.data.map((item, index) => {
          return {
            id: item.id,
            clientId: item.client_id,
            clientName: item.clientname,
            positionName: item.position_name,
            openings: item.openings,
            country: item.countries,
            countryCode: item.country_code,
            state: item.states,
            city: item.city,
            location: item.locations,
            jobAddress: item.job_address,
            postalCode: item.postal_code,
            jobDescription: item.job_description,
            skillSet: item.skill_set
              ? item.skill_set.split(",").map((s) => s.trim())
              : [],
            minYearExp: item.min_year_exp,
            maxYearExp: item.max_year_exp,
            eduQualification: item.edu_qualification,
            specification: item.specification
              ? item.specification
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [],
            salaryType: item.salary_type,
            payType: item.pay_type,
            minSalary: item.min_salary,
            maxSalary: item.max_salary,
            jobType: item.job_type,
            isRemoteWork: !!item.is_remote_work,
            industry: item.industry,
            gender: item.gender,
            contactPersonName: item.contact_person_name,
            personContact: item.person_contact,
            personEmail: item.person_email,
            jdJson: item.jd_json ? JSON.parse(item.jd_json) : null,
          };
        });

        const session = await this.session.getSession(phone);
        const appliedJobIds =
          session && session.appliedJobIds.length > 0
            ? session.appliedJobIds
            : null;

        jobs.forEach((job) => {
          job.isWishlisted = true;

          if (appliedJobIds !== null) {
            job.isApplied = appliedJobIds.includes(job.id);
          }
        });

        return {
          statusCode: 200,
          success: true,
          message: response.data.message,
          data: {
            jobs: jobs,
            pagination: {
              currentPage: response.data.pagination.current_page,
              lastPage: response.data.pagination.last_page,
              perPage: response.data.pagination.per_page,
              total: response.data.pagination.total,
            },
          },
        };
      } else {
        return {
          statusCode: 400,
          success: false,
          message: "No wishlisted jobs found.",
          data: null,
        };
      }
    } catch (error) {
      console.error("Error fetching wishlisted jobs: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured fetching wishlisted jobs.",
        data: null,
      };
    }
  }

  //Fetch semantically relevant wishlist jobs by embedding a query string, with optional hard filters and jobIds scope.
  async fetchSemanticWishlist(
    phone,
    query,
    filters = {},
    perPage = 10,
    pageNo = 1,
  ) {
    try {
      let wishlistIds = null;

      const session = await this.session.getSession(phone);
      if (session && session.wishlistIds && session.wishlistIds.length > 0) {
        wishlistIds = session.wishlistIds;
      } else {
        const response = await axios.post(
          `https://white-force.com/plus/api/candidate-wishlist-ids`,
          {
            mobile: phone,
          },
          {
            headers: {
              "x-api-key": process.env.WIRA_API_KEY,
            },
          },
        );

        if (
          !response.data.status ||
          !response.data.data ||
          response.data.data.length === 0
        ) {
          return {
            statusCode: 400,
            success: false,
            message: "No wishlisted jobs found.",
            data: null,
          };
        }

        wishlistIds = response.data.data;
      }

      const result = await this.fetchSemanticJobs(
        query,
        filters,
        wishlistIds,
        perPage,
        pageNo,
        phone,
      );
      if (!result.success) {
        return result;
      }

      return {
        ...result,
        message: "Semantic wishlist fetched successfully.",
      };
    } catch (error) {
      console.error("Error fetching semantic wishlist: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error fetching semantic wishlist.",
        data: null,
      };
    }
  }

  //Fetch summarized applied jobs with their status info.
  async fetchAppliedJobs(phone, perPage = 10, pageNo = 1, appliedIds = []) {
    function deriveStatus(item) {
      if (!item.pipeline_data) {
        return "applied";
      }

      if (item.pipeline_data.is_joined) {
        return "joined";
      }

      if (item.pipeline_data.stage) {
        return item.pipeline_data.stage.toLowerCase();
      }

      return "applied";
    }

    try {
      const requests = [];

      requests.push(
        axios.get(
          `https://white-force.com/plus/api/candidate-applied-jobs?mobile=${phone}&per_page=${perPage}&page=${pageNo}`,
          {
            headers: {
              "x-api-key": process.env.WIRA_API_KEY,
            },
          },
        ),
      );

      if (appliedIds && appliedIds.length > 0) {
        const start = (pageNo - 1) * perPage;
        const pagedIds = appliedIds.slice(start, start + perPage);

        if (pagedIds.length > 0) {
          requests.push(
            this.fetchJobs(pagedIds, phone).then((result) => {
              if (result.success) {
                return {
                  _source: "fetchJobs",
                  ...result,
                };
              }

              return Promise.reject("fetchJobs failed");
            }),
          );
        }
      }

      const winner = await Promise.any(
        requests.map((r) =>
          Promise.resolve(r).then((res) => {
            if (res && res._source === "fetchJobs") {
              return res;
            }

            if (res && res.data && res.data.status) {
              return {
                _source: "api",
                ...res,
              };
            }

            return Promise.reject("Request failed or invalid");
          }),
        ),
      );

      if (winner._source === "fetchJobs") {
        const jobs = winner.data.jobs;

        const session = await this.session.getSession(phone);
        const wishlistIds =
          session && session.wishlistIds.length > 0
            ? session.wishlistIds
            : null;

        jobs.forEach((job) => {
          job.isApplied = true;

          if (wishlistIds !== null) {
            job.isWishlisted = wishlistIds.includes(job.id);
          }
        });

        return {
          statusCode: 200,
          success: true,
          message: "Applied jobs retrieved successfully.",
          data: {
            jobs: jobs,
            pagination: {
              currentPage: pageNo,
              lastPage: Math.ceil(appliedIds.length / perPage),
              perPage: perPage,
              total: appliedIds.length,
            },
          },
        };
      }

      const response = winner;

      if (
        response.data &&
        response.data.data &&
        response.data.data.length > 0
      ) {
        const jobs = response.data.data.map((item) => {
          const pipelineData = item.pipeline_data;

          return {
            id: item.job_id,
            clientId: item.position_details.client_id,
            clientName: item.position_details.clientname,
            positionName: item.position_details.position_name,
            openings: item.position_details.openings,
            country: item.position_details.countries,
            countryCode: item.position_details.country_code,
            state: item.position_details.states,
            city: item.position_details.city,
            location: item.position_details.locations,
            jobAddress: item.position_details.job_address,
            postalCode: item.position_details.postal_code,
            jobDescription: item.position_details.job_description,
            skillSet: item.position_details.skill_set
              ? item.position_details.skill_set.split(",").map((s) => s.trim())
              : [],
            minYearExp: item.position_details.min_year_exp,
            maxYearExp: item.position_details.max_year_exp,
            eduQualification: item.position_details.edu_qualification,
            specification: item.position_details.specification
              ? item.position_details.specification
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [],
            salaryType: item.position_details.salary_type,
            payType: item.position_details.pay_type,
            minSalary: item.position_details.min_salary,
            maxSalary: item.position_details.max_salary,
            jobType: item.position_details.job_type,
            isRemoteWork: !!item.position_details.is_remote_work,
            industry: item.position_details.industry,
            gender: item.position_details.gender,
            contactPersonName: item.position_details.contact_person_name,
            personContact: item.position_details.person_contact,
            personEmail: item.position_details.person_email,
            jdJson: item.position_details.jd_json
              ? JSON.parse(item.position_details.jd_json)
              : null,
            status: deriveStatus(item),
            pipelineData: pipelineData
              ? {
                  id: pipelineData.id,
                  positionId: pipelineData.position_id,
                  stage: pipelineData.stage,
                  updatedAt: pipelineData.updated_at,
                  interviewDate: pipelineData.interview_date,
                  interviewTimeFrom: pipelineData.interview_time_from,
                  interviewTimeTo: pipelineData.interview_time_to,
                  interviewVenue: pipelineData.interview_venue,
                  interviewStage: pipelineData.interview_stage,
                  joiningDate: pipelineData.joining_date,
                  isJoined: pipelineData.is_joined,
                }
              : null,
          };
        });

        const session = await this.session.getSession(phone);
        const wishlistIds =
          session && session.wishlistIds.length > 0
            ? session.wishlistIds
            : null;

        jobs.forEach((job) => {
          job.isApplied = true;

          if (wishlistIds !== null) {
            job.isWishlisted = wishlistIds.includes(job.id);
          }
        });

        return {
          statusCode: 200,
          success: true,
          message: response.data.message,
          data: {
            jobs,
            pagination: {
              currentPage: response.data.pagination.current_page,
              lastPage: response.data.pagination.last_page,
              perPage: response.data.pagination.per_page,
              total: response.data.pagination.total,
            },
          },
        };
      } else {
        return {
          statusCode: 400,
          success: false,
          message: "No applied jobs found.",
          data: null,
        };
      }
    } catch (error) {
      console.error("Error fetching applied jobs: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured fetching applied jobs.",
        data: null,
      };
    }
  }

  //Fetch semantically relevant applied jobs by embedding a query string, with optional hard filters and jobIds scope.
  async fetchSemanticApplied(
    phone,
    query,
    filters = {},
    perPage = 10,
    pageNo = 1,
  ) {
    try {
      let appliedIds = null;

      const session = await this.session.getSession(phone);
      if (
        session &&
        session.appliedJobIds &&
        session.appliedJobIds.length > 0
      ) {
        appliedIds = session.appliedJobIds;
      } else {
        const response = await axios.post(
          `https://white-force.com/plus/api/candidate-applied-ids`,
          {
            mobile: phone,
          },
          {
            headers: {
              "x-api-key": process.env.WIRA_API_KEY,
            },
          },
        );

        if (
          !response.data.status ||
          !response.data.data ||
          response.data.data.length === 0
        ) {
          return {
            statusCode: 400,
            success: false,
            message: "No applied jobs found.",
            data: null,
          };
        }

        appliedIds = response.data.data;
      }

      const result = await this.fetchSemanticJobs(
        query,
        filters,
        appliedIds,
        perPage,
        pageNo,
        phone,
      );
      if (!result.success) {
        return result;
      }

      const returnedJobIds = result.data.jobs.map((job) => job.id);
      const statusResult = await this.fetchJobStatus(phone, returnedJobIds);
      const statusMap = new Map();

      if (statusResult.success) {
        statusResult.data.statuses.forEach((s) => statusMap.set(s.id, s));
      }

      const jobs = result.data.jobs.map((job) => {
        const statusEntry = statusMap.get(job.id);

        return {
          ...job,
          status: statusEntry ? statusEntry.status : null,
          pipelineData: statusEntry ? statusEntry.pipelineData : null,
        };
      });

      return {
        statusCode: 200,
        success: true,
        message: "Semantic applied jobs fetched successfully.",
        data: {
          jobs: jobs,
          pagination: result.data.pagination,
        },
      };
    } catch (error) {
      console.error("Error fetching semantic applied jobs: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error fetching semantic applied jobs.",
        data: null,
      };
    }
  }

  //Fetch a shorthand isApplied and isWishlist for fast cross checks.
  async fetchIsWishlistedOrApplied(phone, jobIds) {
    try {
      const session = await this.session.getSession(phone);

      if (session) {
        const wishlistIds = session.wishlistIds ?? [];
        const appliedJobIds = session.appliedJobIds ?? [];

        return {
          statusCode: 200,
          success: true,
          message: "Fetched isWishlisted/isApplied successfully.",
          data: jobIds.map((id) => ({
            id: id,
            isWishlisted: wishlistIds.includes(id),
            isApplied: appliedJobIds.includes(id),
          })),
        };
      }

      const response = await axios.post(
        `https://white-force.com/plus/api/wish-list-status`,
        {
          mobile: phone,
          job_id: jobIds,
        },
        {
          headers: {
            "x-api-key": process.env.WIRA_API_KEY,
          },
        },
      );

      if (response.data.status) {
        return {
          statusCode: 200,
          success: true,
          message: "Fetched isWishlisted/isApplied successfully.",
          data: response.data.data,
        };
      } else {
        return {
          statusCode: 500,
          success: false,
          message: "Error occured fetching isWishlisted/isApplied",
          data: null,
        };
      }
    } catch (error) {
      console.error("Error occured fetching isWishlisted/isApplied: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured fetching isWishlisted/isApplied",
        data: null,
      };
    }
  }

  //Fetch job application statuses
  async fetchJobStatus(phone, jobIds = []) {
    try {
      const response = await axios.post(
        `https://white-force.com/plus/api/candidate-application-status`,
        {
          mobile: phone,
          job_id: jobIds,
        },
        {
          headers: {
            "x-api-key": process.env.WIRA_API_KEY,
          },
        },
      );

      if (response.data.status) {
        if (response.data.data && response.data.data.length > 0) {
          const statuses = response.data.data.map((item) => {
            const pipelineData = item.pipeline_data;

            return {
              id: item.id,
              status: item.status,
              pipelineData: pipelineData
                ? {
                    id: pipelineData.id,
                    positionId: pipelineData.position_id,
                    stage: pipelineData.stage,
                    updatedAt: pipelineData.updated_at,
                    interviewDate: pipelineData.interview_date,
                    interviewTimeFrom: pipelineData.interview_time_from,
                    interviewTimeTo: pipelineData.interview_time_to,
                    interviewVenue: pipelineData.interview_venue,
                    interviewStage: pipelineData.interview_stage,
                    joiningDate: pipelineData.joining_date,
                    isJoined: pipelineData.is_joined,
                  }
                : null,
            };
          });

          return {
            statusCode: 200,
            success: true,
            message: response.data.message,
            data: {
              statuses: statuses,
            },
          };
        } else {
          return {
            statusCode: 400,
            success: false,
            message: "No job statuses found.",
            data: null,
          };
        }
      } else {
        return {
          statusCode: 500,
          success: false,
          message: "Error occured fetching job statuses.",
          data: null,
        };
      }
    } catch (error) {
      console.error("Error fetching job statuses: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured fetching job statuses.",
        data: null,
      };
    }
  }

  //Fetch test results.
  async fetchTests(phone, jobIds = []) {
    try {
      const response = await axios.post(
        `https://white-force.com/plus/api/test-result`,
        {
          mobile: phone,
          jobId: jobIds,
        },
        {
          headers: {
            "x-api-key": process.env.WIRA_API_KEY,
          },
        },
      );

      if (response.data.status) {
        if (response.data.data && response.data.data.length > 0) {
          return {
            statusCode: 200,
            success: true,
            message: "Test results fetched successfully.",
            data: {
              tests: response.data.data,
            },
          };
        } else {
          return {
            statusCode: 400,
            success: false,
            message: "No test results found.",
            data: null,
          };
        }
      } else {
        return {
          statusCode: 500,
          success: false,
          message: "Error fetching test results.",
          data: null,
        };
      }
    } catch (error) {
      console.error("Error fetching test results: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error fetching test results.",
        data: null,
      };
    }
  }

  //Fetch screening results.
  async fetchScreenings(phone, jobIds = []) {
    try {
      const response = await axios.post(
        `https://white-force.com/plus/api/screening-result`,
        {
          mobile: phone,
          jobId: jobIds,
        },
        {
          headers: {
            "x-api-key": process.env.WIRA_API_KEY,
          },
        },
      );

      if (response.data.status) {
        if (response.data.data && response.data.data.length > 0) {
          return {
            statusCode: 200,
            success: true,
            message: "Screening results fetched successfully.",
            data: {
              screenings: response.data.data,
            },
          };
        } else {
          return {
            statusCode: 400,
            success: false,
            message: "No screening results found.",
            data: null,
          };
        }
      } else {
        return {
          statusCode: 500,
          success: false,
          message: "Error fetching screening results.",
          data: null,
        };
      }
    } catch (error) {
      console.error("Error fetching screening results: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error fetching screening results.",
        data: null,
      };
    }
  }

  //Fetch if subscribed.
  async isSubscribed(phone) {
    try {
      const response = await axios.post(
        `https://white-force.com/plus/api/subscription-status`,
        {
          mobile: phone,
        },
        {
          headers: {
            "x-api-key": process.env.WIRA_API_KEY,
          },
        },
      );

      if (response.data.status) {
        return {
          statusCode: 200,
          success: true,
          message: "Subscription status fetched successfully.",
          data: {
            isSubscribed: response.data.data.subscribed,
          },
        };
      } else {
        return {
          statusCode: 500,
          success: false,
          message: "Error fetching subscription status.",
          data: null,
        };
      }
    } catch (error) {
      console.error("Error occured fetching is subscribed: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured fetching subscription status.",
        data: null,
      };
    }
  }

  //Fetch all the files that have been sent/recieved between Wira and User
  async fetchCandidateFiles(phone, webName = "White Force") {
    try {
      const result = await this.database.fetchCandidateFiles(phone, webName);
      return result;
    } catch (error) {
      console.error("Error occured fetching candidate files: ", error);

      return {
        statusCode: 500,
        success: false,
        message: "Error occured fetching candidate files.",
        data: null,
      };
    }
  }
}

module.exports = WiraRetrieve;
